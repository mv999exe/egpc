// Wire every "coming soon" card to a simple alert.
document.querySelectorAll("[data-coming-soon]").forEach(function (card) {
  card.addEventListener("click", function () {
    alert("Coming soon");
  });
});
