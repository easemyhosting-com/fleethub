import { expect, it } from "vitest";
import { classifyProviderConfig } from "../src/lib/providers/config-security";
import type { ProviderPlugin } from "../src/lib/plugins/types";
const plugin: ProviderPlugin = { id:"fixture",name:"Fixture",capabilities:[],configFields:[
 {key:"region",label:"Region",description:"",type:"select",required:false,options:[{label:"Europe",value:"eu"}]},
 {key:"workers",label:"Workers",description:"",type:"number",required:false},
 {key:"token",label:"Token",description:"",type:"password",required:false,secret:true},
],collect:async()=>({resources:[],samples:[],health:{ok:false,latencyMs:0}}) };
it("validates public select options and keeps freeform values in the vault boundary",()=>{
 expect(classifyProviderConfig(plugin,{region:"eu"})).toEqual({kind:"inventory",publicConfig:{region:"eu"}});
 expect(classifyProviderConfig(plugin,{region:"unknown"})).toMatchObject({kind:"invalid"});
 expect(classifyProviderConfig(plugin,{region:12})).toMatchObject({kind:"invalid"});
 expect(classifyProviderConfig(plugin,{workers:Number.NaN})).toMatchObject({kind:"invalid"});
 expect(classifyProviderConfig(plugin,{workers:1})).toEqual({kind:"vault-required"});
 expect(classifyProviderConfig(plugin,{token:"secret"})).toEqual({kind:"vault-required"});
 expect(classifyProviderConfig(plugin,{region:null})).toEqual({kind:"inventory",publicConfig:{}});
});
