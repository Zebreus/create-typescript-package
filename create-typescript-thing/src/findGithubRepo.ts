import { getUserRepos } from "createGithubRepo"

const trashSearch = (needle: string, haystack: string[]) => {
  const haystackLower = haystack.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""))
  const needleLower = needle.toLowerCase().replace(/[^a-z0-9]/g, "")
  const matches = haystackLower.flatMap((element, index) => (element.includes(needleLower) ? [{ element, index }] : []))
  if (matches.length > 0) {
    return haystack[
      (
        matches.find(({ index }) => haystack[index] === needle) ??
        matches.find(({ element }) => element === needleLower) ??
        matches[0]
      ).index
    ]
  }

  return undefined
}

export const findGithubRepo = async (accessToken: string, name: string) => {
  const repos = await getUserRepos(accessToken)
  const names = repos.map(repo => repo.name)
  const searchResult = trashSearch(name, names)
  if (!searchResult) {
    return
  }
  return repos.find(repo => repo.name === searchResult)
}
