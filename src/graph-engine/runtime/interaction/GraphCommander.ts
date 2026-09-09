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
    for (const command of coalesceCommands(this.commands.drain())) this.registry.dispatch(command);
  }
}

function coalesceCommands(commands: readonly GraphRuntimeCommandV1[]): readonly GraphRuntimeCommandV1[] {
  const result: GraphRuntimeCommandV1[] = [];
  for (const command of commands) {
    const previous = result[result.length - 1];
    if (previous && sameIdentity(previous, command) && previous.type === command.type) {
      if (command.type === 'pan-by' && previous.type === 'pan-by') {
        result[result.length - 1] = {
          ...command,
          deltaX: previous.deltaX + command.deltaX,
          deltaY: previous.deltaY + command.deltaY,
        };
        continue;
      }
      if (command.type === 'orbit-by' && previous.type === 'orbit-by') {
        result[result.length - 1] = {
          ...command,
          deltaX: previous.deltaX + command.deltaX,
          deltaY: previous.deltaY + command.deltaY,
        };
        continue;
      }
      if (command.type === 'zoom-by' && previous.type === 'zoom-by') {
        result[result.length - 1] = { ...command, deltaY: previous.deltaY + command.deltaY };
        continue;
      }
      if (command.type === 'focal-length-zoom-by' && previous.type === 'focal-length-zoom-by') {
        result[result.length - 1] = { ...command, deltaY: previous.deltaY + command.deltaY };
        continue;
      }
      if (command.type === 'drag-update' && previous.type === 'drag-update'
        && command.nodeId === previous.nodeId) {
        result[result.length - 1] = command;
        continue;
      }
    }
    result.push(command);
  }
  return result;
}

function sameIdentity(a: GraphRuntimeCommandV1, b: GraphRuntimeCommandV1): boolean {
  return a.identity.documentId === b.identity.documentId
    && a.identity.documentRevision === b.identity.documentRevision;
}
