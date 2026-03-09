import { buildGatewayApp } from "./app.js";

const app = buildGatewayApp();
const port = Number(process.env.PORT ?? 4020);

app.listen({ host: "0.0.0.0", port }).catch((error) => {
  console.error(error);
  process.exit(1);
});
