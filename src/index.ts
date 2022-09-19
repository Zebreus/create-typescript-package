import { getGithubCliCredentials } from "accessGithubCliCredentials"
import chalk from "chalk"
import { createTypescriptThing, Options } from "create-typescript-thing-lib"
import { createGithubAccessToken } from "createGithubAccessToken"
import { createGithubRepo, getDefaultBranch, getUserInfo, getUserRepos } from "createGithubRepo"
import { determinePackageManager } from "determinePackageManager"
import { findGithubRepo } from "findGithubRepo"
import { existsSync } from "fs"
import fetch from "node-fetch"
import ora from "ora"
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
  // True if the path was explicitly set
  explicitPath?: boolean
  // github username
  githubUsername?: string
  // github token
  githubToken?: string
  // github protocol
  gitProtocol?: "https" | "ssh"

  packageManager?: "pnpm" | "yarn" | "npm"
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
    (
      await sh(`cd ${firstExistingPathUp} ; git rev-parse --is-inside-work-tree`).catch(() => ({ stdout: "false" }))
    ).stdout.trim() === "true"
  const gitOrigin = inGitTree
    ? (await sh(`cd ${firstExistingPathUp} ; git remote get-url origin`).catch(() => undefined))?.stdout.trim()
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
  const gitUsername = (await sh("git config --get user.name").catch(() => ({ stdout: "" }))).stdout.trim() || undefined
  const gitEmail = (await sh("git config --get user.email").catch(() => ({ stdout: "" }))).stdout.trim() || undefined
  const osUsername = userInfo().username || undefined
  const credentials = await getGithubCliCredentials()
  const githubUserinfo = credentials?.accessToken
    ? await getUserInfo(credentials.accessToken).catch(() => undefined)
    : undefined

  return {
    ...settings,
    authorName: settings.authorName ?? githubUserinfo?.name ?? credentials?.user ?? gitUsername ?? osUsername,
    authorEmail: settings.authorEmail ?? gitEmail, // Not using the github email, as it might be private

    gitUsername: githubUserinfo?.name ?? credentials?.user ?? gitUsername,
    gitEmail: gitEmail,
    osUsername: osUsername,
    githubUsername: githubUserinfo?.name ?? credentials?.user,
    githubToken: credentials?.accessToken,
    gitProtocol: credentials?.protocol ?? "ssh",
  }
}

const validateGitRepo = async (gitUrl: string) => {
  return (await sh(`git ls-remote ${gitUrl}`).catch(() => ({ stdout: "" })))?.stdout?.includes("HEAD")
}

const buildGitRepoUrl = (type: "github" | "gitlab", username: string, name: string) => {
  const host = `${type}.com`
  return `git@${host}:${username}/${name}.git`
}

const guessGitAccount = async (settings: PackageSettings): Promise<PackageSettings> => {
  const email = settings.gitEmail
  const username = settings.gitUsername

  if (settings.githubUsername) {
    return {
      ...settings,
      gitAccount: {
        type: "github",
        username: settings.githubUsername,
        confidence: settings.githubToken ? 1 : 0.5,
      },
    }
  }

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
      githubUsername: githubEmailUsername,
      githubToken: githubEmailUsername === settings.githubUsername ? settings.githubToken : undefined,
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
      githubUsername: githubUsernameFromUsername,
      githubToken: githubUsernameFromUsername === settings.githubUsername ? settings.githubToken : undefined,
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
      githubUsername: undefined,
      githubToken: undefined,
    }
  }

  return settings
}

const addRepoUrl = async (settings: PackageSettings): Promise<PackageSettings> => {
  const pathinfo = getPathInfo(settings)

  const defaultBranch =
    settings.branch ||
    (settings.gitAccount?.type === "github" && settings.githubToken && settings.name
      ? await getDefaultBranch(settings.githubToken, settings.name)
      : undefined)

  if (pathinfo?.gitOrigin) {
    return {
      ...settings,
      repo: settings.repo ?? pathinfo?.gitOrigin,
      branch: defaultBranch,
    }
  }

  if (settings.githubToken && settings.githubUsername && settings.name) {
    const foundGithubRepo = await findGithubRepo(settings.githubToken, settings.name)
    if (foundGithubRepo) {
      return {
        ...settings,
        repo: `git@github.com:${foundGithubRepo.fullName}.git`,
        branch: defaultBranch,
      }
    }
  }

  if (settings.repo || !settings.gitAccount || !settings.name) {
    return {
      ...settings,
      branch: defaultBranch,
    }
  }

  const repoUrl = buildGitRepoUrl(settings.gitAccount.type, settings.gitAccount.username, settings.name)

  if (!(await validateGitRepo(repoUrl))) {
    return settings
  }

  return {
    ...settings,
    repo: repoUrl,
    branch: defaultBranch,
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
      message: "What is your name?",
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
      message: "What is your email?",
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
      message: "What do you want to create today?",
      choices: [
        { title: "A library", value: "library", description: "A javascript library" },
        {
          title: "An application",
          value: "application",
          description: "A interactive cli application",
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

/** Check if a packae can be created in directory */
const checkPath = (directory: string) => {
  return !existsSync(path.resolve(directory, "package.json"))
}

const checkDefaultPackageName = (name: string, settings: PackageSettings, directory?: string) => {
  const validProjectName = ![
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
  ].includes(name)

  const validPath = settings.explicitPath ? true : checkPath(path.resolve(settings.invokeDirectory, directory || name))

  const validName = validate(name).validForNewPackages

  return validProjectName && validPath && validName
}

const recommendNewPackageName = (settings: PackageSettings) => {
  const defaultNames = [
    ...(settings.name
      ? [
          {
            name: settings.name,
            dir: settings.path || settings.name,
          },
        ]
      : []),
    ...(settings.path && settings.explicitPath
      ? [
          {
            name: normalizeString(path.basename(path.normalize(path.resolve(settings.invokeDirectory, settings.path)))),
            dir: settings.path,
          },
        ]
      : []),
    {
      name: normalizeString(path.basename(path.normalize(path.resolve(settings.invokeDirectory)))),
      dir: ".",
    },
    {
      name: `fancy-${settings.type || "package"}`,
      dir: `./fancy-${settings.type || "package"}`,
    },
    {
      name: `cool-${settings.type || "package"}`,
      dir: `./cool-${settings.type || "package"}`,
    },
    {
      name: `flamboyant-${settings.type || "package"}`,
      dir: `./flamboyant-${settings.type || "package"}`,
    },
    {
      name: `classy-${settings.type || "package"}`,
      dir: `./classy-${settings.type || "package"}`,
    },
    {
      name: `flashy-${settings.type || "package"}`,
      dir: `./flashy-${settings.type || "package"}`,
    },
    {
      name: `posh-${settings.type || "package"}`,
      dir: `./posh-${settings.type || "package"}`,
    },
  ]

  const defaultName = defaultNames.find(({ name, dir }) => checkDefaultPackageName(name, settings, dir))

  return defaultName
}

const selectName = async (settings: PackageSettings) => {
  const defaultName = recommendNewPackageName(settings)

  const result = await prompts(
    {
      type: "text",
      name: "name",
      message: "What is your package named?",
      initial: settings.name || defaultName?.name || undefined,
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

  const newPath =
    normalizeString(path.basename(settings.invokeDirectory)) === normalizeString(result.name)
      ? "."
      : normalizeString(result.name)

  return addPathInfo({
    ...settings,
    name: result.name as string,
    path: !settings.explicitPath ? newPath : settings.path || newPath,
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
      message: "Where should your package be located?",
      initial: settings.path || defaultPath || ".",
      validate: path =>
        path ? (checkPath(path) ? true : "That path already contains a node project.") : "You must provide a path.",
    },
    { onCancel }
  )

  return addPathInfo({
    ...settings,
    path: path.normalize(result.path) as string,
    name: settings.name || normalizeString(path.basename(path.normalize(result.path))),
    explicitPath: true,
  })
}

const selectDescription = async (
  settings: PackageSettings,
  prompt = "Give me a short description of your package:"
) => {
  const result = await prompts(
    {
      type: "text",
      name: "description",
      message: prompt,
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

  const pathInfo = getPathInfo(settings)

  if (!pathInfo) {
    throw new Error("At this point a path should have been specified.")
  }

  const parsedOrigin = (
    await sh(`cd ${pathInfo.firstExistingPathUp} && git remote get-url origin`).catch(() => ({ stdout: "" }))
  ).stdout.trim()

  const wasMonorepo =
    !result.monorepo && pathInfo.firstExistingPathUp !== pathInfo.absolutePath && pathInfo.gitOrigin === parsedOrigin

  const newRepo =
    result.monorepo && parsedOrigin && !settings.repo ? parsedOrigin : wasMonorepo ? undefined : settings.repo

  const newSettings = {
    ...settings,
    monorepo: result.monorepo as boolean,
    repo: newRepo,
  }

  // Ask to select git repo if the repo got unset
  return newSettings.repo === undefined && settings.repo !== undefined ? await selectOrigin(newSettings) : newSettings
}

const selectGithubAccount = async (settings: PackageSettings): Promise<PackageSettings> => {
  const result = await prompts(
    {
      type: "confirm",
      name: "login",
      message: "Please sign into github so I can find or create a repository for this package.",
      initial: true,
    },
    { onCancel }
  )

  if (!result.login) {
    return settings
  }

  const validRepoUrl = settings.repo ? validateGitRepo(settings.repo) : false

  const accessToken = await createGithubAccessToken()
  await getUserRepos(accessToken)
  const userInfo = await getUserInfo(accessToken)

  const newSettings: PackageSettings = {
    ...settings,
    gitAccount: {
      type: "github",
      username: userInfo.name,
      confidence: 1,
    },
    githubToken: accessToken,
    githubUsername: userInfo.name,
  }

  return (await validRepoUrl) ? newSettings : await addRepoUrl(newSettings)
}

const selectOrigin = async (settings: PackageSettings) => {
  const defaultRepoUrl =
    settings.gitAccount && settings.name
      ? buildGitRepoUrl(settings.gitAccount.type, settings.gitAccount.username, settings.name)
      : ""

  const result = await prompts(
    {
      type: "text",
      name: "repo",
      message: "Do you already have a git repository?",
      initial: settings.repo || defaultRepoUrl,
      validate: repo =>
        repo.startsWith("http") || repo.startsWith("git@") || repo.startsWith("ssh") || repo === ""
          ? true
          : "Please enter a valid git repository URL",
    },
    { onCancel }
  )

  const repoExists = result.repo && (await validateGitRepo(result.repo))
  const parsedRepoName = result.repo?.split(":")?.[1]?.replace(".git", "").split("/")[1]
  const githubUrl = buildGitRepoUrl("github", settings.githubUsername || "", parsedRepoName)

  if (!repoExists && settings.githubToken && githubUrl === result.repo) {
    const result = await prompts(
      {
        type: "confirm",
        name: "create",
        message: `Do you want to create the repo on github? (Signed in as ${settings.githubUsername})`,
        initial: true,
      },
      { onCancel }
    )
    if (result.create) {
      const settingsWithDescription = settings.description
        ? settings
        : await selectDescription(settings, "You should add a short description.")
      await createGithubRepo(settingsWithDescription.githubToken || "", parsedRepoName, settings.description || "")
    }
  }

  const defaultBranch =
    settings.branch ||
    (parsedRepoName && settings.githubToken && githubUrl === result.repo
      ? await getDefaultBranch(settings.githubToken, parsedRepoName)
      : undefined)

  return {
    ...settings,
    repo: (result.repo || undefined) as string | undefined,
    branch: defaultBranch,
  }
}

const selectPackageManager = async (settings: PackageSettings) => {
  const result = await prompts(
    {
      type: "select",
      name: "packageManager",
      message: "What package manager do you use?",
      choices: [
        {
          title: "Npm",
          value: "npm",
          description: "The package manager that comes with node",
        },
        {
          title: "pNpm",
          value: "pnpm",
          description: "Fast, disk space efficient package manager",
        },
        { title: "Yarn", value: "yarn", description: "The yarn package manager. I think yarn classic" },
      ],
    },
    { onCancel }
  )

  return {
    ...settings,
    packageManager: result.packageManager as PackageSettings["packageManager"],
  }
}

const awaitWithTimeout = async <T>(promise: Promise<T>, timeout: number, defaultValue: T): Promise<T> => {
  const timeoutPromise = new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      defaultValue !== undefined ? resolve(defaultValue) : reject(new Error("Timeout"))
    }, timeout)
  })

  return await (Promise<T>).race([promise, timeoutPromise])
}

const reviewSettings = async (settings: PackageSettings): Promise<PackageSettings> => {
  const repoExists = settings.repo ? validateGitRepo(settings.repo) : (async () => true)()
  const shortTimeoutRepoExists = (repoExists && (await awaitWithTimeout(repoExists, 100, true))) || false

  console.log(`I will create the ${chalk.blue(settings.type)} package ${chalk.blue(settings.name)} into ${chalk.blue(settings.path)}`)
  // if (settings.authorName || settings.authorEmail) {
  //   console.log(
  //     `I will set the author as ${chalk.blue(settings.authorName)}${
  //       settings.authorEmail ? ` <${chalk.blue(settings.authorEmail)}> ` : " "
  //     }. ${settings.description ? "You haven't defined a description yet, if you want you can do this now." : ""}`
  //   )
  // }

  if (settings.monorepo) {
    console.log(
      `I won't create a git repository, because the package is inside a ${chalk.blue("monorepo")} ${
        settings.repo ? `(${chalk.blue(settings.repo)})` : ""
      }`
    )
  } else {
    if (settings.repo) {
      console.log(
        `I will use the git repository at ${chalk.blue(settings.repo)} as the remote repository.
        ${!shortTimeoutRepoExists ? chalk.red("The repository does not exist, please create it before continuing.") : ""}`
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
    ...(settings.repo && !shortTimeoutRepoExists ? ["repo"] : []),
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
        { title: `Type         : ${settings.type}`, description: "Change what what your packages is", value: "type" },
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
          description: "Set to true if your project is not in the root of a git repo",
          value: "monorepo",
        },
        {
          title: settings.packageManager ? `Lockfiles    : ${settings.packageManager}` : `Select your package manager`,
          description: "Select which package manager you are going to use",
          value: "packageManager",
        },
      ],
      initial: 0,
    },
    { onCancel }
  )

  switch (result.selection) {
    case "create": {
      if (settings.repo && !(await repoExists)) {
        console.log(chalk.red("The repository does not exist, please create it before continuing."))
        return reviewSettings(settings)
      }
      return settings
    }
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
    case "packageManager":
      return reviewSettings(await selectPackageManager(settings))
    default:
      throw new Error("Unexpected selection")
  }
}

;(async () => {
  const authorSettings = addAuthorInfo({
    type: "library",
    invokeDirectory: path.normalize(process.cwd()),
    pathInfos: {},
  } as PackageSettings).then(settings => guessGitAccount(settings))

  const packageManagerSettings = determinePackageManager().then(packageManager => ({
    packageManager,
  }))

  //TODO: Determine author name

  const s1 = selectType({
    type: "library",
    invokeDirectory: path.normalize(process.cwd()),
    pathInfos: {},
  })

  const initialSettings = await Promise.all([authorSettings, s1, packageManagerSettings])

  const s11 = { ...initialSettings[0], type: initialSettings[1].type, ...initialSettings[2] }

  const s2 = await selectName(s11)

  const s200 = await selectDescription(s2)

  const pathInfo = getPathInfo(s2)

  if (!pathInfo) {
    throw new Error("Handle this somehow")
  }

  const s20 = s200.githubToken ? s200 : await selectGithubAccount(s200)

  const s21 = await addRepoUrl(s20)

  const s22 = s21.repo ? s21 : await selectOrigin(s21)

  //TODO: Determine and create path here

  const s3 = await reviewSettings(s22)

  const nameChecked = s3.name
  if (!nameChecked) {
    throw new Error("Name is not set")
  }

  const spinner2 = ora("Creating package").start()

  const ctsOptions: Options = {
    path: s3.path || ".",
    name: nameChecked,
    description: s3.description,
    type: s3.type || "library",
    authorName: s3.authorName,
    authorEmail: s3.authorEmail,
    packageManager: s3.packageManager,
    disableGitCommits: false,
    disableGitRepo: s3.monorepo,
    gitOrigin: s3.repo,
    gitBranch: s3.branch,

    logger: {
      logMessage: (message, { type }) => {
        const oldMessage = spinner2.text
        const spinning = spinner2.isSpinning
        switch (type) {
          case undefined:
          case "info":
            spinner2.info(message)
            break
          case "error":
            spinner2.fail(message)
            break
          case "success":
            spinner2.succeed(message)
            break
          case "warning":
            spinner2.warn(message)
            break
        }

        if (spinning) {
          spinner2.start(oldMessage)
        }
      },
      logState: (id, { text, state }) => {
        switch (state) {
          case undefined:
            if (text !== undefined) {
              spinner2.text = text
            }
            break
          case "active":
            spinner2.start(text)
            break
          case "completed":
            spinner2.succeed(text)
            break
          case "failed":
            spinner2.fail(text)
            break
          case "pending":
            spinner2.info(text)
            break
        }
      },
    },
  }

  await createTypescriptThing(ctsOptions)
  if (spinner2.isSpinning) {
    spinner2.succeed(`Created ${s3.name}`)
  }
  // const projectPromise = createTypescriptThing(ctsOptions)

  // const texts = [
  //   `Creating ${blue(s3.name)}`,
  //   `${blue(s3.name)} should be ready in a few seconds`,
  //   `This should take one minute or less`,
  //   `Still creating ${blue(s3.name)}`,
  //   `${blue(s3.name)} will be ready at any minute`,
  //   `It will only take a few more seconds`,
  //   "Nearly done",
  //   "Ok, maybe it is going to take a bit logner then I anticipated",
  //   `${blue(s3.name)} should be ready soon`,
  //   "Maybe your device is just really slow?",
  //   "Maybe this script is really inefficient?",
  //   "You could star this script while you are waiting https://github.com/Zebreus/create-typescript-thing",
  //   "You could star this script while you are waiting https://github.com/Zebreus/create-typescript-thing",
  //   "It should be done by now",
  //   "Hang in there",
  //   `Waiting for ${blue(s3.name)}`,
  // ]
  // const spinner = ora(texts[0]).start()

  // let nextText = 0

  // const textChange = setInterval(() => {
  //   spinner.text = texts[nextText]
  //   nextText = (nextText + 1) % texts.length
  // }, 20000)

  // try {
  //   await projectPromise
  //   clearInterval(textChange)
  //   spinner.succeed(`Created ${s3.name}`
  // } catch (error) {
  //   clearInterval(textChange)
  //   spinner.fail("Failed to create package")
  //   console.error(error)
  // }
})()

export {}
