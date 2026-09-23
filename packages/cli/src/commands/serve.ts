export { StartupFailure } from "@usagekit/server/main";
import { serverMain } from "@usagekit/server/main";
export const serve = (args: string[]) => serverMain(args);
