// @ts-check
import { appRoot } from "@prisma/composer";
import nodejsService from "./service.mjs";

export default appRoot("nodejs-argo", ({ provision }) => {
  provision(nodejsService);
});
