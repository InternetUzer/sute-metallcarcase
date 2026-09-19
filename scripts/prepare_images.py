"""Build small WebP renditions while preserving downloaded originals."""
from pathlib import Path
import json
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
items=json.loads((ROOT/'content/source/candidates.json').read_text())
selections={'hero':35,'hangar':44,'warehouse':61,'fabrication':4,'assembly':74,'concrete':19,
            'panels':26,'frame':54,'model-office':0,'model-arch':7,'model-unit':3,'model-wash':9,
            'drawing':45,'storage':73,'agriculture':23,'modular':11}
out=ROOT/'static/images/web'
out.mkdir(parents=True,exist_ok=True)
assets={}
for key,index in selections.items():
    item=items[index]
    source_path=ROOT/item['path']
    if key.startswith('model-'):
        import sys
        sys.path.insert(0,str(ROOT))
        from content import MODELS
        model=next(m for m in MODELS if m['image']==key)
        local=ROOT/'static/images/original'/(model['id']+'-sketchfab.jpg')
        if local.exists():
            source_path=local
            item={**item,'source_url':'https://sketchfab.com/3d-models/'+model['id']}
    im=ImageOps.exif_transpose(Image.open(source_path)).convert('RGB')
    im.thumbnail((1600,1200))
    im.save(out/(key+'.webp'),'WEBP',quality=85,method=6)
    assets[key]={'src':'/static/images/web/'+key+'.webp','width':im.width,'height':im.height,'source':item['source_url']}
    small=im.copy();small.thumbnail((640,640));small.save(out/(key+'-small.webp'),'WEBP',quality=80)
    assets[key]['small']='/static/images/web/'+key+'-small.webp'
(ROOT/'content/assets.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2))
gallery=[]
for i,(key,title,category) in enumerate([('hero','Ангар из металлоконструкций','buildings'),('fabrication','Монтаж металлического каркаса','construction'),('hangar','Арочное здание','buildings'),('warehouse','Складское здание','buildings'),('panels','Ограждающие конструкции ангара','construction'),('concrete','Строительная площадка','construction')]):
    gallery.append({'id':'source-'+str(i),'title':title,'description':'Фотография из галереи Металл-Каркас. Обсудите подходящее решение для вашего объекта.','image':assets[key]['src'],'category':category,'location':''})
(ROOT/'content/gallery.json').write_text(json.dumps(gallery,ensure_ascii=False,indent=2))
print('Prepared',len(assets),'web assets')
