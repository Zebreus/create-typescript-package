import which from "which"

export const determinePackageManager = async () => {
  const byArgs = determineByArgs()
  if (byArgs) {
    return byArgs
  }

  const byEnv = determineByEnv()
  if (byEnv) {
    return byEnv
  }

  const byInstalledPackageManagers = await determineByInstalledPackageManagers()
  if (byInstalledPackageManagers) {
    return byInstalledPackageManagers
  }
}

const determineByArgs = () => {
  const execpath = process.argv0
  if (execpath.includes("pnpm")) return "pnpm"
  if (execpath.includes("yarn")) return "yarn"
  if (execpath.includes("npm")) return "npm"

  return undefined
}

const determineByEnv = () => {
  const execpath = process.env.npm_execpath ?? ""
  if (execpath.includes("pnpm")) return "pnpm"
  if (execpath.includes("yarn")) return "yarn"
  if (execpath.includes("npm")) return "npm"

  const configUserAgent = process.env.npm_config_user_agent ?? ""
  if (configUserAgent.includes("pnpm")) return "pnpm"
  if (configUserAgent.includes("yarn")) return "yarn"
  if (configUserAgent.includes("npm")) return "npm"

  return undefined
}

const determineByInstalledPackageManagers = async () => {
  const pnpm = which("pnpm")
    .then(() => "pnpm" as const)
    .catch(() => undefined)
  const yarn = which("yarn")
    .then(() => "yarn" as const)
    .catch(() => undefined)
  const npm = which("npm")
    .then(() => "npm" as const)
    .catch(() => undefined)

  const packageManager = (await Promise.all([pnpm, yarn, npm])).filter(x => !!x)[0]

  return packageManager
}
