import { KnowledgeStore } from "../packages/storage/index.js";
import { MockKnowledgeExtractor } from "../packages/knowledge-engine/mock-extractor.js";
import { KnowledgeService } from "../packages/knowledge-engine/service.js";
const store=new KnowledgeStore();const service=new KnowledgeService(store,new MockKnowledgeExtractor());
const session=service.start({title:"ESP32 固件备份 Demo",source_host:"local-demo"});
await service.capture({session_id:session.session_id,user_message:"运行 esptool chip_id，然后 read-flash 保存 backup.bin",assistant_message:"已识别芯片并只读导出 Flash。下一步检查文件大小和哈希。",tool_observations:["Reading at 0x00001000... 10%","Reading at 0x00001000... 20%","Hash verified."],source_reference:"demo-turn-1"});
console.log(JSON.stringify(service.get(session.session_id),null,2));console.log(service.export(session.session_id,"markdown").content);store.close();
