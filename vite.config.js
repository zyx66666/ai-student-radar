import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserOrOrgPage = repositoryName.endsWith(".github.io");

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS
    ? isUserOrOrgPage
      ? "/"
      : `/${repositoryName}/`
    : "./",
});
