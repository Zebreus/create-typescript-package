# Create Typescript Thing
Create a typescript project with formatting, linting, testing, debugging, git and publishing in under 2 minutes.

The interactive setup will lead you through the process of picking a name, creating a github repository, and setting up a project.

# Quick overview

```bash
npx create-typescript-thing
# Interactive setup
cd your-new-project
yarn start
```

<p align='center'>

<img src='https://raw.githubusercontent.com/Zebreus/create-typescript-thing/master/screencast.svg' width='750' alt='create-typescript-thing' />
</p>

# Philosophy

- __No magic single dependency:__ Create typescript thing just creates config files for you. After creating your project you will not have to use create-typescript-thing again.
<!--- - __As normal as possible:__ The goal of this project is to create _normal_ projects. This means that this is opinionated, but only with really mainstream opinions. While I would like to believe this to be true, one look into my eslint config proves otherwise. --->
- __Reducing complexity:__ The created projects try to be as default as possible. Additional complexity is only added when it is needed to add simplicity somewhere else.
- __Opinionated:__ This project is opinionated. It is opinionated about what tools to use, and how to use them. The choices are for the most part based on what is mainstream.
- __Creating familiar environments:__ You can use this to create many different types of projects that all feel similar to work with. The folder structure should be familiar, the linting and formatting should be familiar, the testing should be familiar, how debugging works should be familiar and so on.
- __Ask only necessary questions:__ The interactive setup will ask you only the questions that are necessary to create your project. It will not ask you questions about things that can be guessed or inferred.

# What's included
- TypeScript
- Prettier
- ESLint
- Jest
- husky/lint-staged
- vscode presets
- nix shell

# Features that you maybe don't expect
- Import things relative to the source directory. No more `../../../` in your imports. Just do `import { thing } from 'foo'` to import from `src/foo.ts`.
- Unused imports are removed automatically.
- Cli applications get bundled using `ncc`.

# Some other things that belong in another section

This repo is only the interactive setup. If you want to use the setup directly from javascript, have a look at [create-typescript-thing-lib](https://github.com/Zebreuss/create-typescript-thing-lib).

Debugging is done via the vscode debugger. You can debug your tests with the vscode jest extension.