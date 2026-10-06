import hashlib
from urllib.parse import urlsplit,unquote
REMOTE_URLS = (
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_module_internal.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_module_internal.wasm',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
)

class NetworkLedger:
    """Every request identity and every response is accountable, including duplicates."""
    def __init__(self,base,manifest):
        self.base=base;self.expected=manifest['distRequiredSha256'];self.entries={};self.blocked=[]
    def key(self,url):
        if url in REMOTE_URLS: return ('remote',url)
        if url.startswith(self.base+'/'):
            parsed=urlsplit(url)
            if parsed.query or parsed.fragment: return None
            name=unquote(parsed.path).lstrip('/') or 'index.html'
            if name in self.expected: return ('local',name)
        return None
    def request(self,request):
        identity=id(request)
        if identity not in self.entries:
            key=self.key(request.url)
            self.entries[identity]={'request':request,'key':key,'method':request.method,'finished':False,'failed':False,'responses':[]}
            if key is None or request.method!='GET': self.blocked.append({'kind':'nonallowlisted-request'})
        return self.entries[identity]
    def response(self,response):
        entry=self.request(response.request);entry['responses'].append(response)
    def finished(self,request): self.request(request)['finished']=True
    def failed(self,request): self.request(request)['failed']=True
    def finalize(self):
        records=[];hashes={};locals_seen=set();valid=not self.blocked
        captured=list(self.entries.values());counts=[len(e['responses']) for e in captured]
        for index,entry in enumerate(captured):
            key=entry['key'];record={'requestIndex':index,'key':key,'finished':entry['finished'],'failed':entry['failed'],'responses':[],'valid':True}
            if key is None or entry['method']!='GET' or not entry['finished'] or entry['failed'] or not entry['responses']:
                record['valid']=False
            for response in entry['responses']:
                item={'status':response.status,'sha256':None}
                if entry['finished'] and not entry['failed'] and response.status==200:
                    try: item['sha256']=hashlib.sha256(response.body()).hexdigest()
                    except Exception: item['error']='body-hash-unavailable'
                else: item['error']='response-incomplete-or-non200'
                if item['sha256'] is None: record['valid']=False
                elif key and key[0]=='local':
                    locals_seen.add(key[1])
                    if item['sha256']!=self.expected[key[1]]: record['valid']=False;item['error']='approved-asset-mismatch'
                elif key and key[0]=='remote':
                    prior=hashes.get(key[1])
                    if prior is not None and prior!=item['sha256']: record['valid']=False;item['error']='conflicting-response-bytes'
                    hashes[key[1]]=item['sha256']
                record['responses'].append(item)
            valid=valid and record['valid'];records.append(record)
        valid=valid and set(hashes)==set(REMOTE_URLS) and locals_seen==set(self.expected)
        valid=valid and len(captured)==len(self.entries) and counts==[len(e['responses']) for e in captured]
        return {'networkValid':bool(valid),'networkRecords':records,'runtimeHashes':hashes,'blockedRequests':self.blocked}
