import type { GraphRuntimeCommandV1 } from './GraphInteractionTypes.ts';
import type { BufferedQueue } from './BufferedQueue.ts';

type CommandHandler = (command: GraphRuntimeCommandV1) => void;

export class GraphCommandRegistry {
  private readonly handlers = new Map<GraphRuntimeCommandV1['type'], CommandHandler>();

  register(type: GraphRuntimeCommandV1['type'], handler: CommandHandler): void {
    this.handlers.set(type, handler);
  }

  dispatch(command: GraphRuntimeCommandV1): void {
    this.handlers.get(command.type)?.(command);
  }
}

export class GraphCommander {
  constructor(
    private readonly commands: BufferedQueue<GraphRuntimeCommandV1>,
    private readonly registry: GraphCommandRegistry,
  ) {}

  tick(): void {
    for (const command of this.commands.drain()) this.registry.dispatch(command);
  }
}
