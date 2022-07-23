import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, normalize } from "path"
import { parse, stringify } from "yaml"

export const getGithubCliCredentials = () => {
  const githubCliConfigPath = homedir() + "/.config/gh/hosts.yml"
  if (existsSync(githubCliConfigPath)) {
    const githubCliConfig = parse(readFileSync(githubCliConfigPath, "utf8")) as
      | undefined
      | {
          ["github.com"]?: { user?: string; oauth_token?: string; git_protocol?: "ssh" | "https" }
        }
    if (
      typeof githubCliConfig !== "object" ||
      !githubCliConfig ||
      !githubCliConfig["github.com"] ||
      typeof githubCliConfig["github.com"] !== "object"
    ) {
      return
    }
    const githubComObject = githubCliConfig["github.com"]
    return {
      accessToken: githubComObject.oauth_token,
      user: githubComObject.user,
      protocol: githubComObject.git_protocol,
    }
  }
}

export const setGithubCliCredentials = (accessToken: string, user?: string, protocol?: "https" | "ssh") => {
  const githubCliConfigPath = homedir() + "/.config/gh/hosts.yml"
  const configExists = existsSync(githubCliConfigPath)
  const parsedConfig =
    configExists &&
    (parse(readFileSync(githubCliConfigPath, "utf8")) as
      | undefined
      | {
          ["github.com"]?: { user?: string; oauth_token?: string; git_protocol?: "ssh" | "https" }
        })
  if (configExists && (!parsedConfig || typeof parsedConfig !== "object")) {
    throw new Error("The github cli config is not a valid json")
  }
  if (configExists && parsedConfig && parsedConfig["github.com"] && typeof parsedConfig["github.com"] !== "object") {
    throw new Error("Config entry for github.com needs to be an object")
  }
  if (!configExists) {
    mkdirSync(dirname(normalize(githubCliConfigPath)))
  }

  const newConfig = {
    ...(parsedConfig || {}),
    ["github.com"]: {
      ...((parsedConfig || {})["github.com"] || {}),
      oauth_token: accessToken,
      ...(user ? { user } : {}),
      ...(protocol ? { git_protocol: protocol } : {}),
    },
  }

  writeFileSync(githubCliConfigPath, stringify(newConfig, null, 2))
}
