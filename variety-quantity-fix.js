'use strict';

// Column D in the Variety Packs sheet means "cans of this product in one pack".
// Build each pack by adding those column-D values, then scale the completed
// recipe once by the number of packs ordered.
(function installVarietyQuantityFix(){
  function packTotalFromTitle(title){
    const match=safe(title).match(/\b(\d{1,2})\s*[- ]?\s*(pack|pk)\b/i);
    return match ? Number(match[1]) : 0;
  }

  buildVariety=function(values){
    const map=new Map();
    if(values.length<2) return map;

    const headers=headerMap(values[0]);
    const packCol=col(headers,['variety pack name','pack name','pack']);
    const itemCol=col(headers,['beer name','item','title','product']);
    const qtyCol=col(headers,['qty per pack item','qtyperpackitem','qty','quantity']);
    const imageCol=col(headers,['beer image url','image url','imageurl']);
    if(packCol<0||itemCol<0) return map;

    values.slice(1).forEach(row=>{
      const pack=safe(row[packCol]);
      const title=safe(row[itemCol]);
      if(!pack||!title) return;

      const key=packKey(pack);
      const entry=map.get(key)||{
        packTitle:pack,
        items:[],
        totalCans:0,
        expectedCans:packTotalFromTitle(pack)
      };
      const cansPerPackItem=Math.max(1,parseQty(row[qtyCol]));

      entry.items.push({
        title,
        cansPerPackItem,
        imageUrl:imageCol>=0?safe(row[imageCol]):''
      });
      entry.totalCans+=cansPerPackItem;
      map.set(key,entry);
    });

    map.forEach(entry=>{
      if(entry.expectedCans&&entry.totalCans!==entry.expectedCans){
        console.warn(`Variety pack total mismatch: ${entry.packTitle} adds to ${entry.totalCans}, expected ${entry.expectedCans}.`);
      }
    });

    return map;
  };

  expandAndMergeOrder=function(order){
    const merged=new Map();

    for(const source of order.items){
      const rule=state.variety.get(packKey(source.itemTitle));
      const rows=rule?.items?.length
        ? rule.items.map(component=>{
            const orderedPacks=source.units;
            const cansPerPackItem=component.cansPerPackItem;
            return {
              ...source,
              itemTitle:component.title,
              variantTitle:'Variety pack component',
              units:orderedPacks,
              packSize:cansPerPackItem,
              cans:orderedPacks*cansPerPackItem,
              imageUrl:component.imageUrl||source.imageUrl
            };
          })
        : [source];

      for(const row of rows){
        const key=normalize(row.itemTitle);
        const lookup=state.lookup.get(key);
        const loc=parseLocation(lookup?.locCode);

        if(!merged.has(key)){
          merged.set(key,{
            key,
            itemTitle:row.itemTitle,
            qtyCans:0,
            locCode:lookup?.locCode||'',
            locLabel:loc.label,
            locSort:loc.sort,
            imageUrl:imageFor(lookup?.imageUrl||row.imageUrl,row.itemTitle),
            sources:[]
          });
        }

        const item=merged.get(key);
        item.qtyCans+=row.cans;
        item.sources.push({units:row.units,packSize:row.packSize});
      }
    }

    order.items=[...merged.values()].sort((a,b)=>compareSort(a.locSort,b.locSort)||a.itemTitle.localeCompare(b.itemTitle));
    return order;
  };

  // script.js begins its first load immediately. Once that load is finished,
  // reload once with the corrected pack recipe model.
  let refreshed=false;
  function refreshWithFixedLogic(){
    if(refreshed) return;
    if(state.loading){
      window.setTimeout(refreshWithFixedLogic,25);
      return;
    }
    refreshed=true;
    loadAll();
  }
  refreshWithFixedLogic();
})();
