import chalk from "chalk"
import clipboard from "clipboardy"
import fetch from "node-fetch"
import open from "open"
import readline from "readline"

const fetchCode = async (clientId: string) => {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    body: `{"client_id": "${clientId}", "scope": "repo"}`,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  })
  const parts = await response.json()

  const userCode = parts.user_code
  const deviceCode = parts.device_code
  const interval = +("" + parts.interval)
  const expiresIn = +("" + parts.expires_in)
  const verificationUri = parts.verification_uri

  if (!userCode || !deviceCode || isNaN(interval) || isNaN(expiresIn) || !verificationUri) {
    throw new Error("Failed to get valid device code")
  }

  return { deviceCode, userCode, interval, expiresIn, verificationUri }
}

const fetchToken = async (
  deviceCode: string,
  interval: number,
  clientId: string
): Promise<{ accessToken: string; tokenType: string; scope: string[] }> => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: clientId,
    }),
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  })

  const jsonResponse = (await response.json()) as
    | {
        error: "authorization_pending"
      }
    | {
        error: "slow_down"
        interval: number
      }
    | {
        error: "error"
        error_description: string
      }
    | {
        error: undefined
        access_token: string
        token_type: string
        scope: string
      }

  if (jsonResponse.error) {
    if (jsonResponse.error === "authorization_pending") {
      await new Promise(resolve => setTimeout(resolve, interval * 1000))
      return await fetchToken(deviceCode, interval, clientId)
    }
    if (jsonResponse.error === "slow_down") {
      await new Promise(resolve => setTimeout(resolve, jsonResponse.interval * 1000))
      return await fetchToken(deviceCode, jsonResponse.interval, clientId)
    }
    throw new Error(jsonResponse.error_description)
  }

  const accessToken = jsonResponse.access_token
  const tokenType = jsonResponse.token_type
  const scope = jsonResponse.scope

  if (!accessToken || !tokenType || !scope) {
    throw new Error("Failed to get valid access token")
  }

  return { accessToken, tokenType, scope: scope.split(":").filter(scope => !!scope) }
}

export const createGithubAccessToken = async () => {
  const clientId = "243bcc16248cdf06dce0"
  const code = await fetchCode(clientId)
  console.log(`Your one-time code: ${chalk.bold(code.userCode)}`)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  rl.question(`${chalk.bold("Press enter")} to copy the code and open a browser at ${code.verificationUri}`, () => {
    try {
      clipboard.writeSync(code.userCode)
    } catch (e) {
      console.log("Failed to copy code to clipboard")
    }
    open(code.verificationUri)
    rl.close()
  })

  const tokenResponse = await fetchToken(code.deviceCode, code.interval, clientId)
  rl.close()

  return tokenResponse.accessToken
}
