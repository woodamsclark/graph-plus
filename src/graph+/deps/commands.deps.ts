import type { DrainableBuffer }           from "../types/domain/ui.ts";
import type { Command, CommandObserver }  from "../types/domain/commands.ts";
import type { CommandRegistry }           from "../systems/3. Module Commander/Commander.ts";

export type CommandSystemDeps = {
  queue:      DrainableBuffer<Command>;
  registry:   CommandRegistry;
  observers?: CommandObserver[];
};
