class Cli {
  params: Record<string, string> = {};
  commands: string[] = [];

  constructor() {
    this.parse_args();
  }

  parse_args() {
    const args = process.argv.slice(2);

    let prev_key = "";
    let is_command = true;

    for (const arg_raw of args) {
      const arg = arg_raw.trim();
      if (!arg) continue;

      if (arg.startsWith("--")) {
        is_command = false;
        const key = arg.replace("--", "");
        prev_key = key;
        this.params[key] = "true";
      } else if (prev_key) {
        this.params[prev_key] = arg;
        prev_key = "";
      } else if (is_command) {
        this.commands.push(arg);
      }
    }
  }
}

const cli = new Cli();

export default cli;
