import fetch from "node-fetch"

type UserInfo = {
  name: string
  email: string
}
const userInfoByToken: Record<string, undefined | Promise<UserInfo>> = {}
export const getUserInfo = async (accessToken: string) => {
  const prevPromise = userInfoByToken[accessToken]
  if (prevPromise) {
    return prevPromise
  }
  const promise = (async () => {
    const response = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}`, Accept: "application/vnd.github+json" },
    })
    const jsonResponse = (await response.json()) as undefined | { name?: string; email?: string }
    if (!jsonResponse || !jsonResponse.name || !jsonResponse.email) {
      throw new Error("Failed to get user info")
    }
    const result = { name: jsonResponse.name, email: jsonResponse.email }

    return result
  })() as Promise<UserInfo>

  userInfoByToken[accessToken] = promise
  return promise
}

type RepoInfos = {
  owner: string
  visibility: "public" | "private"
  archived: boolean
  description?: string | undefined
  name: string
  fullName: string
}[]
const reposByName: Record<string, undefined | Promise<RepoInfos>> = {}
export const getUserRepos = async (accessToken: string) => {
  const userInfo = await getUserInfo(accessToken)
  const prevPromise = reposByName[userInfo.name]
  if (prevPromise) {
    return prevPromise
  }
  const promise = (async () => {
    const response = await fetch("https://api.github.com/user/repos?sort=created&per_page=100&affiliation=owner", {
      headers: { Authorization: `token ${accessToken}`, Accept: "application/json" },
    })
    const jsonResponse = (await response.json()) as
      | undefined
      | Array<{
          name?: string
          full_name?: string
          description?: string
          owner?: { login?: string }
          email?: string
          visibility?: "public" | "private"
          archived?: boolean
        }>
    if (!jsonResponse || !Array.isArray(jsonResponse)) {
      throw new Error("Failed to get user repos")
    }
    const checkedRepos = jsonResponse?.flatMap(({ name, full_name, description, owner, visibility, archived }) => {
      if (name && full_name && owner && owner.login && visibility && archived != null) {
        return [
          {
            name: name,
            fullName: full_name,
            ...(description ? { description } : {}),
            owner: owner.login,
            visibility: visibility,
            archived: archived,
          },
        ]
      }
      return []
    })
    if (checkedRepos.length !== jsonResponse.length) {
      throw new Error("Got invalid repos")
    }
    return checkedRepos
  })()
  reposByName[userInfo.name] = promise
  return promise
}

export const createGithubRepo = async (accessToken: string, name: string, description: string) => {
  const userInfo = await getUserInfo(accessToken)
  const body = {
    name: name,
    description: description,
    homepage: `https://github.com/${userInfo.name}/${name}`,
    private: false,
    has_projects: false,
    has_wiki: false,
    auto_init: true,
    license_template: "MIT",
    has_downloads: false,
  }

  const response = await fetch("https://api.github.com/user/repos", {
    headers: { Authorization: `token ${accessToken}`, Accept: "application/vnd.github+json" },
    method: "POST",
    body: JSON.stringify(body),
  })
  if (response.status !== 201) {
    throw new Error("Failed to create repo")
  }
  delete reposByName[userInfo.name]
  await getUserRepos(accessToken)
}
