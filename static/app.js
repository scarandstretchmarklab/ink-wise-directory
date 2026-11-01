(function () {
  var grid = document.getElementById('grid');
  if (!grid) return;
  var isRegion = grid.getAttribute('data-region') === '1';
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var zipIn = document.getElementById('zip');
  var status = document.getElementById('status');
  var active = {};
  var zip3 = null;

  function say(t) { status.textContent = t || ''; }
  function miles(a, b) {
    var R = 3958.8, toR = Math.PI / 180;
    var dLa = (b[0] - a[0]) * toR, dLo = (b[1] - a[1]) * toR;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function applyFilters() {
    var keys = Object.keys(active).filter(function (k) { return active[k]; });
    var shown = 0;
    cards.forEach(function (c) {
      var sv = (c.getAttribute('data-sv') || '').split(' ');
      var ok = keys.every(function (k) { return sv.indexOf(k) >= 0; });
      c.hidden = !ok; if (ok) shown++;
    });
    return shown;
  }
  function sortBy(origin, label) {
    cards.forEach(function (c) {
      var ll = c.getAttribute('data-ll'); var d = c.querySelector('.dist');
      if (ll) { var p = ll.split(',').map(Number); c._d = miles(origin, p); d.textContent = ' · ' + Math.round(c._d) + ' mi'; }
      else { c._d = 1e9; d.textContent = ''; }
    });
    cards.sort(function (a, b) { return a._d - b._d; });
    cards.forEach(function (c) { grid.appendChild(c); });
    var shown = applyFilters();
    var first = cards.filter(function (c) { return !c.hidden; })[0];
    if (!shown) say('No artists match those filters yet.');
    else if (first && first._d < 1e9) say('Closest to ' + label + ': ' + Math.round(first._d) + ' miles away');
    else say('No artists near ' + label + ' yet. Showing everyone.');
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function loadZip3(cb) {
    if (zip3) return cb();
    fetch('/zip3.json').then(function (r) { return r.json(); }).then(function (j) { zip3 = j; cb(); })
      .catch(function () { say('ZIP search is unavailable right now.'); });
  }
  function byZip(z) {
    z = (z || '').replace(/\D/g, '').slice(0, 5);
    if (z.length !== 5) { say('Enter a 5-digit ZIP code.'); zipIn && zipIn.focus(); return; }
    if (isRegion) { location.href = '/?zip=' + z; return; }
    loadZip3(function () {
      var p = zip3[z.slice(0, 3)];
      if (!p) { say('We couldn’t find ZIP ' + z + '.'); return; }
      sortBy(p, z);
    });
  }
  function byGeo() {
    if (isRegion) { location.href = '/?near=me'; return; }
    if (!navigator.geolocation) { say('Location isn’t available on this device.'); return; }
    say('Finding your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      sortBy([pos.coords.latitude, pos.coords.longitude], 'you');
    }, function () { say('Location was blocked. Try your ZIP code instead.'); }, { timeout: 10000, maximumAge: 600000 });
  }

  document.getElementById('near').addEventListener('click', function () { byZip(zipIn.value); });
  zipIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); byZip(zipIn.value); } });
  document.getElementById('geo').addEventListener('click', byGeo);
  document.getElementById('region').addEventListener('change', function () { location.href = this.value; });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-k'); active[k] = !active[k];
      b.classList.toggle('on', !!active[k]); b.setAttribute('aria-pressed', active[k] ? 'true' : 'false');
      var n = applyFilters(); say(n ? '' : 'No artists match those filters yet.');
    });
  });

  var q = new URLSearchParams(location.search);
  if (q.get('zip')) { zipIn.value = q.get('zip'); byZip(q.get('zip')); }
  else if (q.get('near') === 'me') byGeo();
})();
