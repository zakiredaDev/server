import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryDirectory = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.join(repositoryDirectory, "server"));

await import("./server/src/server.js");
