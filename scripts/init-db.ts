import { KnowledgeStore } from "../packages/storage/index.js";
const store=new KnowledgeStore();console.log(`Initialized SQLite database: ${store.filename}`);store.close();
