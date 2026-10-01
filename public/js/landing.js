document.getElementById('yr').textContent = new Date().getFullYear();
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
document.querySelectorAll('main section:not(.hero) > *').forEach(el => { el.classList.add('reveal'); io.observe(el); });
