import { hashPassword } from "../src/lib/cloud/password";

async function main() {
  let password = "";
  for await (const chunk of process.stdin) password += chunk;
  console.log(await hashPassword(password.trimEnd()));
}
void main();
