(function () {
	const nav = document.querySelector(".site-nav");
	const toggle = document.querySelector(".nav-toggle");
	const menu = document.getElementById("site-menu");

	if (!nav || !toggle || !menu) {
		return;
	}

	function setOpen(open) {
		toggle.setAttribute("aria-expanded", String(open));
		toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
		nav.classList.toggle("is-open", open);
		document.documentElement.classList.toggle("nav-open", open);
	}

	toggle.addEventListener("click", function () {
		setOpen(toggle.getAttribute("aria-expanded") !== "true");
	});

	document.addEventListener("keyup", function (event) {
		if (event.key === "Escape") {
			setOpen(false);
			toggle.focus();
		}
	});

	menu.querySelectorAll("a").forEach(function (link) {
		link.addEventListener("click", function () {
			setTimeout(function () {
				setOpen(false);
			}, 0);
		});
	});
})();
