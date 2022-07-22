import { blue, red } from "chalk"
import { existsSync } from "fs"
import fetch from "node-fetch"
import { userInfo } from "os"
import path from "path"
import { exit } from "process"
import prompts from "prompts"
import { sh } from "sh"
import validate from "validate-npm-package-name"

const normalizeString = (str: string) =>
  str
    .toLowerCase() // Normalize
    .replace(/[-_.:]/g, "-")
    .trim()
    .split("/") // Clean package names
    .at(-1)
    ?.split("@")
    .at(0) || ""

type GitAccountInfo = {
  type: "github" | "gitlab"
  username: string
  confidence: number
}

type PackageSettings = {
  // Real settings for creation
  path?: string
  name?: string
  description?: string
  type?: "library" | "application"
  monorepo?: boolean
  repo?: string
  branch?: string
  authorName?: string
  authorEmail?: string

  // Only use for this wizard
  /** The directory in which the wizard was invoked */
  invokeDirectory: string
  pathInfos: Record<
    string,
    {
      /** If the target path is inside the git tree */
      inGitTree: boolean
      /** If the target path is a git repository */
      isGitRoot: boolean
      /** If the target path already exists */
      pathExists: boolean
      /** The first existing path, if we move up from the target path */
      firstExistingPathUp: string
      /** The target path with the invoke directory prepended */
      absolutePath: string
      /** The git origin, if it is inside a repository */
      gitOrigin?: string
    }
  >
  gitUsername?: string
  gitEmail?: string
  osUsername?: string
  gitAccount?: GitAccountInfo
}

const onCancel = () => {
  console.log("Bye 👋")
  exit(0)
}

const addPathInfo = async (settings: PackageSettings): Promise<PackageSettings> => {
  if (!settings.path || settings.pathInfos[settings.path]) {
    return settings
  }

  const targetPath = path.normalize(path.resolve(settings.invokeDirectory, settings.path))

  const pathsUp = [targetPath]
  let nextPath: string = targetPath
  do {
    nextPath = path.dirname(nextPath)
    pathsUp.push(nextPath)
  } while (nextPath !== "/" && nextPath !== ".")

  const firstExistingPathUp = pathsUp.find(path => existsSync(path))

  if (!firstExistingPathUp) {
    throw new Error("Could not find any existing path from the target path")
  }

  const pathExists = firstExistingPathUp === targetPath
  const inGitTree =
    (await sh(`cd ${firstExistingPathUp} ; git rev-parse --is-inside-work-tree`)).stdout.trim() === "true"
  const gitOrigin = inGitTree
    ? (await sh(`cd ${firstExistingPathUp} ; git remote get-url origin`)).stdout.trim()
    : undefined

  const isGitRoot = pathExists && existsSync(path.resolve(firstExistingPathUp, ".git"))

  return {
    ...settings,
    repo: settings.repo ?? gitOrigin,
    monorepo: settings.monorepo ?? (inGitTree && !isGitRoot),
    pathInfos: {
      ...settings.pathInfos,
      [settings.path]: {
        pathExists,
        firstExistingPathUp,
        isGitRoot,
        inGitTree,
        absolutePath: targetPath,
        gitOrigin,
      },
    },
  }
}

const addAuthorInfo = async (settings: PackageSettings): Promise<PackageSettings> => {
  const gitUsername = (await sh("git config --get user.name")).stdout.trim() || undefined
  const gitEmail = (await sh("git config --get user.email")).stdout.trim() || undefined
  const osUsername = userInfo().username || undefined

  return {
    ...settings,
    authorName: settings.authorName ?? gitUsername ?? osUsername,
    authorEmail: settings.authorEmail ?? gitEmail,

    gitUsername: gitUsername,
    gitEmail: gitEmail,
    osUsername: osUsername,
  }
}

const validateGitRepo = async (gitUrl: string) => {
  return (await sh(`git ls-remote ${gitUrl}`)).stdout.includes("HEAD")
}

const buildGitRepoUrl = (type: "github" | "gitlab", username: string, name: string) => {
  const host = `${type}.com`
  return `git@${host}:${username}/${name}.git`
}

const guessGitAccount = async (settings: PackageSettings): Promise<PackageSettings> => {
  const email = settings.gitEmail
  const username = settings.gitUsername

  const githubSearchByEmail = (await (await fetch(`https://api.github.com/search/users?q=${email}}`)).json()) as
    | { items: Array<{ login: string }> }
    | undefined
  const githubEmailUsername = githubSearchByEmail?.items?.[0]?.login

  if (githubEmailUsername) {
    return {
      ...settings,
      gitAccount: {
        type: "github",
        username: githubEmailUsername,
        confidence: 1,
      },
    }
  }

  const githubSearchByUsername = (await (await fetch(`https://api.github.com/search/users?q=${username}}`)).json()) as
    | { items: Array<{ login: string }> }
    | undefined
  const githubUsernameFromUsername = githubSearchByUsername?.items?.[0]?.login

  if (githubUsernameFromUsername) {
    return {
      ...settings,
      gitAccount: {
        type: "github",
        username: githubUsernameFromUsername,
        confidence: 0.5,
      },
    }
  }

  const gitlabSearchByUsername = (await (
    await fetch(`https://gitlab.com/api/v4/users?username=${username}}`)
  ).json()) as Array<{ username: string } | undefined> | undefined
  const gitlabUsernameFromUsername = gitlabSearchByUsername?.[0]?.username

  if (gitlabUsernameFromUsername) {
    return {
      ...settings,
      gitAccount: {
        type: "gitlab",
        username: gitlabUsernameFromUsername,
        confidence: 0.5,
      },
    }
  }

  return settings
}

const addRepoUrl = async (settings: PackageSettings): Promise<PackageSettings> => {
  const pathinfo = getPathInfo(settings)
  if (pathinfo?.gitOrigin) {
    return {
      ...settings,
      repo: settings.repo ?? pathinfo?.gitOrigin,
    }
  }

  if (settings.repo || !settings.gitAccount || !settings.name) {
    return settings
  }

  const repoUrl = buildGitRepoUrl(settings.gitAccount.type, settings.gitAccount.username, settings.name)

  if (!(await validateGitRepo(repoUrl))) {
    return settings
  }

  return {
    ...settings,
    repo: repoUrl,
  }
}

const getPathInfo = (settings: PackageSettings) => {
  return (settings.path && settings.pathInfos[settings.path]) || undefined
}

const selectAuthorName = async (settings: PackageSettings) => {
  const result = await prompts(
    {
      type: "text",
      name: "authorName",
      message: "What is your name? (Leave empty to skip)",
      initial: settings.authorName || "",
    },
    { onCancel }
  )

  return {
    ...settings,
    authorName: (result.authorName || undefined) as string | undefined,
  }
}

const selectAuthorEmail = async (settings: PackageSettings) => {
  const result = await prompts(
    {
      type: "text",
      name: "authorEmail",
      message: "What is your name? (Leave empty to skip)",
      initial: settings.authorEmail || "",
    },
    { onCancel }
  )

  return {
    ...settings,
    authorName: (result.authorEmail || undefined) as string | undefined,
  }
}

const selectType = async (settings: PackageSettings) => {
  const result = await prompts(
    {
      type: "select",
      name: "type",
      message: "What type of package do you want to create today?",
      choices: [
        { title: "A library", value: "library", description: "A library that can be published to npm" },
        {
          title: "An application",
          value: "application",
          description: "An cli application that can be published to npm",
        },
        {
          title: "A web3 blockchain project with NFTs",
          value: "web3-nft",
          description: "idk",
          disabled: true,
        },
      ],
      initial: settings.type === "application" ? 1 : 0,
    },
    { onCancel }
  )

  return {
    ...settings,
    type: result.type as PackageSettings["type"],
  }
}

const selectName = async (settings: PackageSettings) => {
  const defaultPackageNameFromPath = normalizeString(
    path.basename(path.normalize(path.resolve(settings.invokeDirectory, settings.path || ".")))
  )

  const invalidProjectNames = [
    "home",
    "root",
    "user",
    "users",
    "www",
    "public",
    "admin",
    "api",
    "dev",
    "test",
    "staging",
    "prod",
    "documents",
    "project",
    path.basename(userInfo().homedir),
    path.basename(userInfo().username),
    ".",
    "-",
  ]

  const defaultPackageName =
    invalidProjectNames.includes(defaultPackageNameFromPath) ||
    defaultPackageNameFromPath.length <= 3 ||
    !validate(defaultPackageNameFromPath).validForNewPackages
      ? "my-fancy-package"
      : defaultPackageNameFromPath

  const result = await prompts(
    {
      type: "text",
      name: "name",
      message: "What is your package named? (only lowercase, numbers and -)",
      initial: settings.name || defaultPackageName,
      validate: name => {
        const validation = validate(path.basename(path.resolve(name)))
        if (validation.validForNewPackages) {
          return true
        }
        return (
          "That's a nice name, but sadly it is invalid, because: " +
          [...(validation.errors || []), ...(validation.warnings || [])].join(" | ")
        )
      },
    },
    { onCancel }
  )

  return addPathInfo({
    ...settings,
    name: result.name as string,
    path:
      settings.path ||
      (normalizeString(path.basename(settings.invokeDirectory)) === normalizeString(result.name)
        ? "."
        : normalizeString(result.name)),
  })
}

const selectPath = async (settings: PackageSettings) => {
  const defaultPath =
    settings.name &&
    (normalizeString(path.basename(settings.invokeDirectory)) === normalizeString(settings.name)
      ? "."
      : `${normalizeString(settings.name)}`)

  const result = await prompts(
    {
      type: "text",
      name: "path",
      message: "Where should you package be located?",
      initial: settings.path || defaultPath || ".",
      validate: path => !!path,
    },
    { onCancel }
  )

  return addPathInfo({
    ...settings,
    path: path.normalize(result.path) as string,
    name: settings.name || normalizeString(path.basename(path.normalize(result.path))),
  })
}

const selectDescription = async (settings: PackageSettings) => {
  const result = await prompts(
    {
      type: "text",
      name: "description",
      message: "Can you tell me a short description of your package? (Leave empty to skip)",
      initial: settings.description || "",
      validate: description =>
        description.length === 0
          ? true
          : description.length < 10
          ? "That's to short."
          : description.length > 500
          ? "Don't you think that's just a little bit excessive? Please write a shorter description."
          : true,
    },
    { onCancel }
  )

  return {
    ...settings,
    description: result.description as string,
  }
}

const selectMonorepo = async (settings: PackageSettings) => {
  const result = await prompts(
    {
      type: "confirm",
      name: "monorepo",
      message: "Is the package part of a monorepo?",
      initial: settings.monorepo || false,
    },
    { onCancel }
  )

  const parsedOrigin = (await sh("git remote get-url origin")).stdout.trim()

  return {
    ...settings,
    monorepo: result.monorepo as boolean,
    repo: result.monorepo && parsedOrigin && !settings.repo ? parsedOrigin : settings.repo,
  }
}

const selectOrigin = async (settings: PackageSettings) => {
  const defaultRepoUrl =
    settings.gitAccount && settings.name
      ? buildGitRepoUrl(settings.gitAccount.type, settings.gitAccount.username, settings.name)
      : ""

  const result = await prompts(
    {
      type: "text",
      name: "origin",
      message: "Do you already have a git repository? (Leave empty to skip)",
      initial: settings.repo || defaultRepoUrl,
      validate: origin =>
        origin.startsWith("http") || origin.startsWith("git@") || origin.startsWith("ssh") || origin === ""
          ? true
          : "Please enter a valid git repository URL",
    },
    { onCancel }
  )

  return {
    ...settings,
    origin: (result.origin || undefined) as string | undefined,
  }
}

const reviewSettings = async (settings: PackageSettings): Promise<PackageSettings> => {
  const repoExists = settings.repo && (await validateGitRepo(settings.repo))

  console.log(`I will create the ${blue(settings.type)} package ${blue(settings.name)} into ${blue(settings.path)}`)
  // if (settings.authorName || settings.authorEmail) {
  //   console.log(
  //     `I will set the author as ${chalk.blue(settings.authorName)}${
  //       settings.authorEmail ? ` <${chalk.blue(settings.authorEmail)}> ` : " "
  //     }. ${settings.description ? "You haven't defined a description yet, if you want you can do this now." : ""}`
  //   )
  // }

  if (settings.monorepo) {
    console.log(
      `I won't create a git repository, because the package is inside a ${blue("monorepo")} ${
        settings.repo ? `(${blue(settings.repo)})` : ""
      }`
    )
  } else {
    if (settings.repo) {
      console.log(
        `I will use the git repository at ${blue(settings.repo)} as the remote repository.
        ${!repoExists ? red("The repository does not exist, please create it before continuing.") : ""}`
      )
    } else {
      console.log(
        `I will create a local git repository for the package. If you want to start with a github repo, configure the git url now.`
      )
    }
  }

  const missingKeys = [
    ...(settings.type ? [] : ["type"]),
    ...(settings.name ? [] : ["name"]),
    ...(settings.path ? [] : ["path"]),
    ...(settings.repo && !repoExists ? ["repo"] : []),
  ]

  const result = await prompts(
    {
      type: "select",
      name: "selection",
      message: "Are you ready to create?",
      warn: `You need to set ${missingKeys.join(", ")}`,
      choices: [
        {
          title: "Yes, let's go!",
          description: "Create the package with the current settings",
          value: "create",
          disabled: missingKeys.length > 0,
        },
        {
          title: settings.description ? `Description  : ${settings.description}` : `Add a package description`,
          description: "Change the description",
          value: "description",
        },
        { title: `Type         : ${settings.type}`, description: "Change the type", value: "type" },
        {
          title: settings.name ? `Name         : ${settings.name}` : `Set the package name`,
          description: "Change the package name",
          value: "name",
        },
        {
          title: settings.path ? `Location     : ${settings.path}` : `Select the install location`,
          description: "Change the install location",
          value: "path",
        },
        {
          title: settings.authorName ? `Author       : ${settings.authorName}` : `Add an author`,
          description: "Change the name of the author",
          value: "authorName",
        },
        {
          title: settings.authorEmail ? `Author email : ${settings.authorEmail}` : `Add your email as author`,
          description: "Change the email of the author",
          value: "authorEmail",
        },
        {
          title: settings.repo ? `Git url      : ${settings.repo}` : `Select a git repo`,
          description: "Change the url of the origin git repository",
          value: "repo",
        },
        {
          title: settings.monorepo ? `In monorepo  : yes` : `In monorepo  : no`,
          description:
            "Change whether your package is part of a monorepo. This affects wheter a pre-commit hook is set up",
          value: "monorepo",
        },
      ],
      initial: 0,
    },
    { onCancel }
  )

  switch (result.selection) {
    case "create":
      return settings
    case "type":
      return reviewSettings(await selectType(settings))
    case "name":
      return reviewSettings(await selectName(settings))
    case "description":
      return reviewSettings(await selectDescription(settings))
    case "path":
      return reviewSettings(await selectPath(settings))
    case "authorName":
      return reviewSettings(await selectAuthorName(settings))
    case "authorEmail":
      return reviewSettings(await selectAuthorEmail(settings))
    case "repo":
      return reviewSettings(await selectOrigin(settings))
    case "monorepo":
      return reviewSettings(await selectMonorepo(settings))
    default:
      throw new Error("Unexpected selection")
  }

  return {
    ...settings,
  }
}

console.log("You launched the application!")
;(async () => {
  const initialSettings = await guessGitAccount(
    await addAuthorInfo({
      type: "library",
      invokeDirectory: path.normalize(process.cwd()),
      pathInfos: {},
    } as PackageSettings)
  )

  //TODO: Determine author name

  const s1 = await selectType(initialSettings)

  const s2 = await selectName(s1)

  const pathInfo = getPathInfo(s2)

  if (!pathInfo) {
    throw new Error("Handle this somehow")
  }

  const s21 = await addRepoUrl(s2)

  const s22 = s21.repo ? s21 : await selectOrigin(s21)

  //TODO: Determine and create path here

  const s3 = await reviewSettings(s22)

  console.log("Your settings ", s3)
})()

export {}
