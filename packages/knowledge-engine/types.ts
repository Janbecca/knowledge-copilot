import type { ExtractionResult, KnowledgeCard } from "../card-protocol/index.js";
import type { Session, Turn } from "../shared/index.js";

export interface ExtractionContext { session: Session; turn: Turn; activeCards: KnowledgeCard[]; }
export interface KnowledgeExtractor { readonly name: string; extract(context: ExtractionContext): Promise<ExtractionResult>; }
