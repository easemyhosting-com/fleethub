import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/freellmapi/route";
afterEach(()=>vi.unstubAllEnvs());
it("does not serve checked-in models, keys or fabricated usage",async()=>{
 vi.stubEnv("NODE_ENV","development");vi.stubEnv("FLEETHUB_AUTH_REQUIRED","true");vi.stubEnv("FLEETHUB_READONLY_KEY","gateway-reader");
 expect((await GET(new Request("http://localhost/api/freellmapi"))).status).toBe(401);
 const response=await GET(new Request("http://localhost/api/freellmapi",{headers:{authorization:"Bearer gateway-reader"}}));
 expect(response.headers.get("cache-control")).toBe("no-store");
 expect(await response.json()).toMatchObject({status:"unavailable",models:[],keyPools:[],quotas:[],telemetry:{gatewayUrl:null,webUiUrl:null,analytics:null}});
});
