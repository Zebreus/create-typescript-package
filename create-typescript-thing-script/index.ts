import { exec } from "child_process"
import { defaultMaxListeners } from "events";
import path from "path";

const sh = async (cmd: string) => {
    return new Promise<{ stdout: string; stderr: string }>(function (resolve, reject) {
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
            const error = new Error("Failed to create package")
            err.stack = undefined
            //@ts-expect-error
            error.details = {...err, stderr, stdout}
            error.stack = undefined
            reject(error);
        } else {
          resolve({ stdout, stderr })
        }
      })
    })
  }

export type PackageSettings = {
    path?: string
    name?: string
    description?: string
    type?: "library" | "application"
    monorepo?: boolean
    repo?: string
    branch?: string
    authorName?: string
    authorEmail?: string
}

export const createTypescriptThingScript = async (settings: PackageSettings) => {
    const script = `/usr/bin/env bash ${path.resolve(__dirname, "create.sh")}`
    const command = script + 
    (settings.path ? " --path " + settings.path : "")
    + (settings.name ? " --name " + settings.name : "")
    + (settings.description ? " --description " + settings.description : "")
    + (settings.type ? " --type " + settings.type : "")
    + (settings.monorepo ? " --in-monorepo" : "")
    + (settings.repo ? " --git-origin " + settings.repo : "")
    + (settings.branch ? " --git-branch " + settings.branch : "")
    + (settings.authorName ? " --author-name " + settings.authorName : "")
    + (settings.authorEmail ? " --author-email " + settings.authorEmail : "")

    await sh(command)
}

export default createTypescriptThingScript
