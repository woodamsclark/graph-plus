import type {
  GraphSessionOptionsV1,
  GraphSessionV1,
  GraphSettingsOverridesV1,
} from '../contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../core/profile/index.ts';
import { GraphSessionRuntime } from './GraphSessionRuntime.ts';
import {
  createSessionRuntimePlatformV1,
  type SessionRuntimePlatformFactoryV1,
} from './platform/index.ts';

export interface SessionFactoryOptionsV1 {
  readonly engineInstanceId: string;
  readonly profiles: ConsumerProfileRegistry;
  readonly globalOverrides?: GraphSettingsOverridesV1;
  readonly createSessionId?: () => string;
  readonly createPlatform?: SessionRuntimePlatformFactoryV1;
}

export class GraphSessionProfileErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphSessionProfileErrorV1';
  }
}

export class SessionFactory {
  private readonly engineInstanceId: string;
  private readonly profiles: ConsumerProfileRegistry;
  private readonly globalOverrides?: GraphSettingsOverridesV1;
  private readonly createSessionId: () => string;
  private readonly createPlatform: SessionRuntimePlatformFactoryV1;
  private nextSessionNumber = 1;

  constructor(options: SessionFactoryOptionsV1) {
    this.engineInstanceId = requireId(options.engineInstanceId, 'engine instance ID');
    this.profiles = options.profiles;
    this.globalOverrides = options.globalOverrides;
    this.createSessionId = options.createSessionId ?? (() => `${this.engineInstanceId}:session:${this.nextSessionNumber++}`);
    this.createPlatform = options.createPlatform ?? createSessionRuntimePlatformV1;
  }

  async createSession(options: GraphSessionOptionsV1): Promise<GraphSessionV1> {
    const profile = this.profiles.resolve(options.consumerId, options.profileId, {
      globalOverrides: this.globalOverrides,
      sessionOverrides: options.sessionOverrides,
    });
    const fatalIssues = profile.issues.filter((issue) => issue.fatal);
    if (fatalIssues.length) {
      throw new GraphSessionProfileErrorV1(fatalIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    }
    const sessionId = requireId(this.createSessionId(), 'session ID');
    return new GraphSessionRuntime({
      sessionId,
      engineInstanceId: this.engineInstanceId,
      consumerId: options.consumerId,
      profileId: options.profileId,
      container: options.container,
      document: options.document,
      profile,
      restoreViewState: options.restoreViewState,
      platform: this.createPlatform(options.container),
    });
  }
}

function requireId(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}
