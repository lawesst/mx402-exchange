import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 4010);

app.listen({ host: "0.0.0.0", port }).catch((error) => {
  console.error(error);
  process.exit(1);
});
