export interface EgoIntent<TDirective> {
  readonly source: 'endogenous';
  readonly directive: TDirective;
}

export type EgoIntentOutcome<TDirective> =
  | { readonly status: 'accepted'; readonly directive: TDirective }
  | { readonly status: 'adjusted'; readonly directive: TDirective }
  | { readonly status: 'rejected'; readonly reason: string };

/** Experience constraints validate meaning; Judgement owns admission policy. */
export type EgoIntentPolicy<TDirective> = (intent: EgoIntent<TDirective>) => EgoIntentOutcome<TDirective>;
export type JudgementRuleV1 = (intent: EgoIntent<unknown>) =>
  | { readonly status: 'allowed' }
  | { readonly status: 'rejected'; readonly reason: string };

let nextJudgementRevision = 0;
const allowEveryIntention: JudgementRuleV1 = () => ({ status: 'allowed' });

/** Pure admission within Ego. The initial policy allows every valid intention. */
export class Judgement {
  readonly revision: number;

  constructor(private readonly rule: JudgementRuleV1 = allowEveryIntention) {
    this.revision = rule === allowEveryIntention ? 0 : ++nextJudgementRevision;
  }

  consider<TDirective>(
    intent: EgoIntent<TDirective>,
    constraints: EgoIntentPolicy<TDirective> = (candidate) => ({ status: 'accepted', directive: candidate.directive }),
  ): EgoIntentOutcome<TDirective> {
    const outcome = constraints(intent);
    if (outcome.status === 'rejected') return outcome;
    const verdict = this.rule({ ...intent, directive: outcome.directive });
    return verdict.status === 'rejected' ? verdict : outcome;
  }
}

/** The same permissive judgement for standalone, host-neutral plan evaluation. */
export const DEFAULT_EGO_JUDGEMENT_V1 = new Judgement();
