import { loadLocalEnvironment } from "./config.js";
import { researchReply } from "./research.js";

loadLocalEnvironment();

const mode = process.argv[2];
const supplied = process.argv.slice(3).join(" ").trim();

const input =
  mode === "--echo"
    ? `echo ${supplied || "CourseSignal bridge ready"}`
    : `research ${
        supplied || "Explain conditional probability using reliable university sources"
      }`;

const result = await researchReply(input);
console.log(result.body);
