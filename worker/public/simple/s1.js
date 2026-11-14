// Design 1: the live diagram, with a line under it. A dot carries the question from station to station and the
// matching box lights up: 3,973 passages, two top-20 lists, the best 8, a JSON reply, checked quotes.
window.DESIGN = {
  flow(root, api) {
    api.defaultFlow(root);
    const nodes = [...root.querySelectorAll("button.node")]; // question, keyword, vector, fuse, claude, check
    const stations = ["3,973 passages", "top 20 + top 20", "best 8 kept", "answer + quotes", "every quote checked"];
    const lit = [[0], [1, 2], [3], [4], [5]];
    const line = api.el("div", undefined, "line"); line.setAttribute("aria-hidden", "true");
    const track = api.el("i", undefined, "track"), bar = api.el("i", undefined, "fillbar"); line.append(track, bar);
    const st = stations.map((s) => { const n = api.el("div", s, "station"); line.append(n); return n; });
    root.after(line);
    const x = (k) => st[k].offsetLeft + st[k].offsetWidth / 2;
    const place = () => { track.style.left = bar.style.left = x(0) + "px"; track.style.width = (x(4) - x(0)) + "px"; };
    requestAnimationFrame(place);
    if (!api.MOTION) return; // reduced motion: no dot, nothing moves
    const dots = [api.el("i", undefined, "dot"), api.el("i", undefined, "dot")];
    line.append(...dots);
    const play = document.getElementById("play");
    play.hidden = false;

    let k = 0, timer = null, running = true;
    function show(stage, instant) {
      k = stage;
      place();
      st.forEach((s, i) => { s.classList.toggle("on", i === k); s.classList.toggle("past", i < k); });
      nodes.forEach((n, i) => n.classList.toggle("lit", lit[k].includes(i)));
      if (instant) bar.style.transition = "none";
      bar.style.width = (x(k) - x(0)) + "px";
      if (instant) { void bar.offsetWidth; bar.style.transition = ""; }
      // two dots: apart on the two searches, together everywhere else
      dots.forEach((d, i) => {
        if (instant) d.style.transition = "none";
        const dx = k === 1 ? (i ? 9 : -9) : 0;
        d.style.transform = `translate(${x(k) + dx}px, 0px)`;
        d.classList.toggle("ok", k === 4);
        if (instant) { void d.offsetWidth; d.style.transition = ""; }
      });
    }
    function tick() {
      if (k === 4) { // hold on the check, then start over from the question without sliding back
        dots.forEach((d) => { d.style.opacity = 0; });
        setTimeout(() => { show(0, true); dots.forEach((d) => { d.style.opacity = 1; }); }, 450);
      } else show(k + 1);
    }
    const start = () => { running = true; play.textContent = "Pause"; clearInterval(timer); timer = setInterval(tick, 1400); };
    const stop = () => { running = false; play.textContent = "Play the flow"; clearInterval(timer); };
    play.onclick = () => (running ? stop() : start());
    // clicking a box stops the loop and moves the dot to that step
    nodes.forEach((n, i) => n.addEventListener("click", () => { stop(); show([0, 1, 1, 2, 3, 4][i]); }));
    addEventListener("resize", () => show(k, true));
    // run only while the diagram is on screen
    new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && running) { clearInterval(timer); timer = setInterval(tick, 1400); } else clearInterval(timer); }), { threshold: 0.2 }).observe(line);
    requestAnimationFrame(() => show(0, true));
  },
};
