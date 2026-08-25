import { KnowledgeStore } from "../packages/storage/index.js";
import { MockKnowledgeExtractor } from "../packages/knowledge-engine/mock-extractor.js";
import { KnowledgeService } from "../packages/knowledge-engine/service.js";
export function service(filename=":memory:"){const store=new KnowledgeStore(filename);return {store,service:new KnowledgeService(store,new MockKnowledgeExtractor())};}
