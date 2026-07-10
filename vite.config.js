import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserOrOrgPage = repositoryName.endsWith(".github.io");
const githubPagesBase = isUserOrOrgPage ? "/" : `/${repositoryName}/`;
const base = process.env.VITE_BASE_PATH ?? process.env.BASE_PATH;

export default defineConfig({
  plugins: [react()],
  base: base ?? (process.env.GITHUB_ACTIONS ? githubPagesBase : "./"),
});
