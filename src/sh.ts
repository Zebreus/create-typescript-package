import { exec } from "child_process"

/**
 * Execute simple shell command
 */
export const sh = async (cmd: string) => {
  return new Promise<{ stdout: string; stderr: string }>(function (resolve, reject) {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}
