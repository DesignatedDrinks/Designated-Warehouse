function renderCurrent(){
  const o = currentOrder();
  const nextOrderBtn = document.getElementById('btnNextOrder');

  // clear any previous focus state
  nextOrderBtn.classList.remove('nextOrderFocus');

  rebuildQueue();
  setOrderBar();

  const cur = queue[queueIndex];

  if(!cur){
    // DONE STATE
    document.getElementById('curTitle').textContent = 'DONE — order picked';
    document.getElementById('curSub').textContent = 'Grab boxes and move to packing';
    document.getElementById('curQty').textContent = '✔';
    document.getElementById('curImg').src = '/Designated-Warehouse/done.svg';

    // ⏱️ after 1.5s → prompt Next Order
    setTimeout(()=>{
      nextOrderBtn.classList.add('nextOrderFocus');
    },1500);

    return;
  }

  // NORMAL PICKING STATE
  document.getElementById('curTitle').textContent = cur.itemTitle;
  document.getElementById('curQty').textContent = cur.qtyCans;
  document.getElementById('curImg').src = cur.imageResolved;
}
