import {pulseKeyValid} from './instagram-pulse.controller';
describe('Pulse scoped server authentication',()=>{
 const secret='a'.repeat(64);
 it('fails closed when unconfigured or with a malformed credential',()=>{expect(pulseKeyValid('Bearer '+secret,undefined)).toBe(false);expect(pulseKeyValid(undefined,secret)).toBe(false);expect(pulseKeyValid('Bearer short','short')).toBe(false);expect(pulseKeyValid('Bearer '+secret+'x',secret)).toBe(false);});
 it('accepts only the exact server capability',()=>{expect(pulseKeyValid('Bearer '+secret,secret)).toBe(true);expect(pulseKeyValid(secret,secret)).toBe(false);});
});
import {InstagramPulseController} from './instagram-pulse.controller';
describe('Pulse account boundary and retry safety',()=>{
 const secret='b'.repeat(64),account={id:'ig',username:'perfil.exemplo',organizationId:'org',configurationId:'cfg',status:'CONNECTED',tokenExpiresAt:new Date('2099-01-01'),connectedBy:'owner'};
 const input={action:'bind',username:account.username,post_id:'51027008-1af1-4ec9-91cd-2fdd8bb066bf',template_id:'black',media_id:'18131224663841828',permalink:'https://www.instagram.com/p/abc/'};
 beforeEach(()=>{process.env.PULSE_BRIDGE_KEY=secret;process.env.PULSE_BRIDGE_ACCOUNT_ID='ig';});
 afterEach(()=>{delete process.env.PULSE_BRIDGE_KEY;delete process.env.PULSE_BRIDGE_ACCOUNT_ID;});
 it('rejects another Instagram before any transaction',async()=>{const db:any={instagramAccount:{findUnique:jest.fn().mockResolvedValue(account)},$transaction:jest.fn()};await expect(new InstagramPulseController(db,{} as any).request('Bearer '+secret,{...input,username:'another'})).rejects.toThrow('Conta não autorizada');expect(db.$transaction).not.toHaveBeenCalled();});
 it('returns an existing binding without creating, changing or reactivating a flow',async()=>{const tx:any={$executeRaw:jest.fn(),instagramPublication:{findUnique:jest.fn().mockResolvedValue({snapshot:{mediaId:input.media_id},mode:'LIVE'}),create:jest.fn()},instagramConfiguration:{update:jest.fn()}};const db:any={instagramAccount:{findUnique:jest.fn().mockResolvedValue(account)},$transaction:(fn:any)=>fn(tx)};const result=await new InstagramPulseController(db,{} as any).request('Bearer '+secret,input);expect(result).toMatchObject({state:'linked',reused:true});expect(tx.instagramPublication.create).not.toHaveBeenCalled();expect(tx.instagramConfiguration.update).not.toHaveBeenCalled();});
 it('refuses a retry with a different Instagram media id',async()=>{const tx:any={$executeRaw:jest.fn(),instagramPublication:{findUnique:jest.fn().mockResolvedValue({snapshot:{mediaId:'999999999'},mode:'LIVE'})}};const db:any={instagramAccount:{findUnique:jest.fn().mockResolvedValue(account)},$transaction:(fn:any)=>fn(tx)};await expect(new InstagramPulseController(db,{} as any).request('Bearer '+secret,input)).rejects.toThrow('outra publicação');});
});
