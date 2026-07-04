const API_BASE = "http://localhost:5000/api";

// Persist a session id per browser tab so refresh doesn't lose the conversation.
const sessionId = sessionStorage.getItem("sessionId") || crypto.randomUUID();
sessionStorage.setItem("sessionId", sessionId);

const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const resultCard = document.getElementById("resultCard");
const resultPrice = document.getElementById("resultPrice");
const resultBreakdown = document.getElementById("resultBreakdown");
const pdfLink = document.getElementById("pdfLink");

function addMessage(text, role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

function formatINR(n) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

async function sendMessage(message) {
  addMessage(message, "user");
  const thinking = addMessage("Thinking…", "bot");

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
    });
    const data = await res.json();

    thinking.remove();

    if (!res.ok) {
      addMessage(`⚠️ ${data.error || "Something went wrong."}`, "bot");
      return;
    }

    addMessage(data.reply, "bot");

    if (data.tripReady) {
      addMessage("Searching flights & hotels, then building your day-wise plan… ✨", "system");
      showResult(data);
    }
  } catch (err) {
    thinking.remove();
    addMessage("⚠️ Couldn't reach the planner backend. Is the server running on :5000?", "bot");
  }
}

function showResult(data) {
  resultCard.classList.remove("hidden");
  resultPrice.textContent = formatINR(data.priceBreakdown.total);
  resultBreakdown.innerHTML = `
    Flight: ${formatINR(data.priceBreakdown.flightTotal)} &nbsp;•&nbsp;
    Hotel: ${formatINR(data.priceBreakdown.hotelTotal)}
    ${data.priceBreakdown.overBudget ? " &nbsp;•&nbsp; <span style='color:#c9541f'>slightly over your stated budget</span>" : ""}
  `;
  pdfLink.href = data.pdfUrl;

  // Render a quick day-by-day preview inline in chat too.
  data.itinerary.days.forEach((day) => {
    const card = document.createElement("div");
    card.className = "msg bot";
    card.innerHTML = `<strong>Day ${day.dayNumber}: ${day.title}</strong><br/>` +
      day.activities.map((a) => `• <em>${a.time}:</em> ${a.description}`).join("<br/>");
    chatWindow.appendChild(card);
  });
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  sendMessage(message);
});

// Kick off the conversation.
addMessage(
  "Hi! I'm your Plumtrips planner 👋 Tell me your name, where you're flying from and to, your travel dates, number of travelers, budget, and the vibe you're going for — and I'll build your trip.",
  "bot"
);
