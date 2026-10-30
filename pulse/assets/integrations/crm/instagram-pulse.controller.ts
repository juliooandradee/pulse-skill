import {Body,Controller,ForbiddenException,Headers,Post,BadRequestException,ConflictException} from '@nestjs/common';
import {createHash,timingSafeEqual} from 'node:crypto';
import {PrismaService} from '../config/prisma.service';
import {InstagramLiveService,igAccountLock} from './instagram-live.service';
import {compileFlow,flowsShareEntryPoint,IgFlow} from './instagram-live-input';
import {z} from 'zod';

export function pulseKeyValid(header:unknown,secret:string|undefined){
 if(!secret||secret.length<48||typeof header!=='string')return false;
 const hash=(value:string)=>createHash('sha256').update(value).digest();
 return timingSafeEqual(hash(header),hash(`Bearer ${secret}`));
}
const input=z.object({action:z.enum(['templates','bind','metrics']),username:z.string().regex(/^[a-zA-Z0-9_.]{1,30}$/),post_id:z.string().uuid().optional(),template_id:z.string().max(100).optional(),media_id:z.string().regex(/^\d{5,40}$/).optional(),permalink:z.string().regex(/^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/).optional(),title:z.string().max(160).optional()});

/** Server-to-server capability limited to one configured Instagram account. No inbox or contact data returned. */
@Controller('instagram/pulse')
export class InstagramPulseController{
 constructor(private readonly db:PrismaService,private readonly live:InstagramLiveService){}
 @Post()
 async request(@Headers('authorization') authorization:string,@Body() body:unknown){
  if(!pulseKeyValid(authorization,process.env.PULSE_BRIDGE_KEY)||!process.env.PULSE_BRIDGE_ACCOUNT_ID)throw new ForbiddenException('Integração Pulse não autorizada.');
  const parsed=input.safeParse(body);if(!parsed.success)throw new BadRequestException('Solicitação Pulse inválida.');const b=parsed.data;
  const account=await this.db.instagramAccount.findUnique({where:{id:process.env.PULSE_BRIDGE_ACCOUNT_ID}});
  if(!account||account.username.toLowerCase()!==b.username.toLowerCase())throw new ForbiddenException('Conta não autorizada.');
  const org=account.organizationId;
  if(b.action==='templates'){
   const config=await this.db.instagramConfiguration.findUnique({where:{organizationId:org}});
   return {templates:((config?.flows||[]) as any[]).filter(f=>f.connectionId===account.configurationId&&!f.trashedAt&&f.trigger==='comment'&&!f.id.startsWith('pulse-')).map(f=>({id:f.id,name:f.name}))};
  }
  if(!b.post_id)throw new BadRequestException('Informe o post.');const flowId=`pulse-${b.post_id}`;
  if(b.action==='metrics'){
   const m=await this.live.metrics(org,account.id,flowId);
   const leads=await this.db.$queryRaw<{count:number}[]>`SELECT count(DISTINCT c."personId")::int as count FROM instagram_runs r JOIN instagram_publications p ON p.id=r."publicationId" AND p."organizationId"=r."organizationId" JOIN instagram_conversations c ON c.id=r."conversationId" AND c."organizationId"=r."organizationId" WHERE p."organizationId"=${org} AND p."accountId"=${account.id} AND p."flowId"=${flowId} AND c."personId" IS NOT NULL`;
   return {metrics:{dm_sent:m.sent,dm_delivered:null,clicks:m.clicked,leads:leads[0]?.count??0},collected_at:m.updatedAt};
  }
  if(!b.template_id||!b.media_id||!b.permalink)throw new BadRequestException('Post confirmado e modelo são obrigatórios.');
  if(account.status!=='CONNECTED'||account.tokenExpiresAt<=new Date())throw new ConflictException('Reconecte o Instagram no CRM.');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`instagram-configuration:${org}`}))`;await igAccountLock(tx,account.id);
   const previous=await tx.instagramPublication.findUnique({where:{organizationId_accountId_flowId:{organizationId:org,accountId:account.id,flowId}}});
   if(previous){if((previous.snapshot as any)?.mediaId!==b.media_id)throw new ConflictException('Este post já foi associado a outra publicação.');return {flow_id:flowId,state:previous.mode==='LIVE'?'linked':'paused',reused:true};}
   const config=await tx.instagramConfiguration.findUniqueOrThrow({where:{organizationId:org}}),flows=config.flows as any[];
   const template=flows.find(f=>f.id===b.template_id&&f.connectionId===account.configurationId&&!f.trashedAt&&f.trigger==='comment');
   if(!template)throw new BadRequestException('Modelo de comentário indisponível.');
   const clone={...structuredClone(template),id:flowId,name:`Pulse · ${b.title||template.name}`.slice(0,100),media:'specific',mediaId:b.media_id,updatedAt:new Date().toISOString()};
   const snapshot=compileFlow(clone);
   const active=await tx.instagramPublication.findMany({where:{organizationId:org,accountId:account.id,mode:{in:['LIVE','TEST']}}});
   if(active.some(p=>flowsShareEntryPoint(snapshot as unknown as IgFlow,p.snapshot as unknown as IgFlow)))throw new ConflictException('Já existe uma automação ativa para este post e palavra-chave. Confira no CRM.');
   const revision=config.revision+1;
   await tx.instagramConfiguration.update({where:{organizationId:org},data:{flows:[...flows,clone],revision,updatedById:account.connectedBy}});
   await tx.instagramPublication.create({data:{organizationId:org,accountId:account.id,flowId,snapshot,configurationRevision:revision,mode:'LIVE',testRecipients:[],updatedBy:account.connectedBy}});
   return {flow_id:flowId,state:'linked',reused:false};
  });
 }
}
