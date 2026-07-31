/**
 * Inline client-side JS for the static report. No external scripts, no
 * network requests, no build step — this string is embedded verbatim into
 * a `<script>` tag by `render-report.ts` (PLAN.md §31, §20.4). Everything
 * that renders untrusted (file-derived) text uses `textContent`/DOM
 * construction, never `innerHTML` with concatenated strings, so nothing
 * needs HTML-escaping on the client side either.
 */
export const REPORT_CLIENT_SCRIPT = `
(function () {
  "use strict";

  var report = JSON.parse(document.getElementById("report-data").textContent);

  var imagesById = {};
  report.images.forEach(function (img) { imagesById[img.id] = img; });

  var decisions = {};

  var state = { minConfidence: 0, relationship: "", unresolvedOnly: false, selectedGroupId: null };

  var groupListEl = document.getElementById("group-list");
  var detailEl = document.getElementById("group-detail");
  var countEl = document.getElementById("group-count");

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function relationshipsOf(group) {
    var set = {};
    group.comparisons.forEach(function (c) { set[c.relationship] = true; });
    return Object.keys(set);
  }

  function groupIsUnresolved(group) {
    var decision = decisions[group.id];
    return !decision || decision.action === "defer";
  }

  function matchesFilters(group) {
    if (group.confidence < state.minConfidence) return false;
    if (state.relationship && relationshipsOf(group).indexOf(state.relationship) === -1) return false;
    if (state.unresolvedOnly && !groupIsUnresolved(group)) return false;
    return true;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    var units = ["KB", "MB", "GB"];
    var value = bytes;
    var unitIndex = -1;
    do {
      value = value / 1024;
      unitIndex++;
    } while (value >= 1024 && unitIndex < units.length - 1);
    return value.toFixed(1) + " " + units[unitIndex];
  }

  function imageLabel(image) {
    return image ? image.path : "(unknown image)";
  }

  function renderGroupList() {
    while (groupListEl.firstChild) groupListEl.removeChild(groupListEl.firstChild);
    var filtered = report.groups.filter(matchesFilters);
    countEl.textContent = filtered.length + " / " + report.groups.length + " groups";

    filtered.forEach(function (group) {
      var item = el("button", "group-item" + (group.id === state.selectedGroupId ? " selected" : ""));
      item.type = "button";

      var title = el("div", "group-item-title");
      title.appendChild(el("span", null, group.id));
      title.appendChild(el("span", "badge badge-" + group.status, group.status));
      item.appendChild(title);

      item.appendChild(el(
        "div",
        "group-item-meta",
        group.kind + " \\u00b7 " + group.members.length + " members \\u00b7 confidence " + Math.round(group.confidence * 100) + "%"
      ));

      var decision = decisions[group.id];
      if (decision) {
        item.appendChild(el("div", "group-item-decision", "decision: " + decision.action));
      }

      item.addEventListener("click", function () {
        state.selectedGroupId = group.id;
        renderGroupList();
        renderDetail();
      });

      groupListEl.appendChild(item);
    });
  }

  function appendCropRow(container, image) {
    if (!image || !image.assets) return;
    var row = el("div", "crop-row");
    var hasCrop = false;
    if (image.assets.centerCrop) {
      var center = document.createElement("img");
      center.src = image.assets.centerCrop;
      center.alt = "Centre crop";
      center.loading = "lazy";
      row.appendChild(center);
      hasCrop = true;
    }
    if (image.assets.detailCrop) {
      var detail = document.createElement("img");
      detail.src = image.assets.detailCrop;
      detail.alt = "Highest-detail crop";
      detail.loading = "lazy";
      row.appendChild(detail);
      hasCrop = true;
    }
    if (hasCrop) container.appendChild(row);
  }

  function renderMemberCard(group, memberId) {
    var image = imagesById[memberId];
    var card = el("div", "member-card" + (group.recommendedOriginalId === memberId ? " recommended" : ""));

    if (image && image.assets && image.assets.thumbnail) {
      var thumb = document.createElement("img");
      thumb.src = image.assets.thumbnail;
      thumb.alt = imageLabel(image);
      thumb.loading = "lazy";
      card.appendChild(thumb);
    }

    card.appendChild(el("div", "member-path", imageLabel(image)));

    if (image) {
      card.appendChild(el(
        "div",
        "member-stats",
        image.format.toUpperCase() + " \\u00b7 " + image.width + "\\u00d7" + image.height + " \\u00b7 " + formatBytes(image.fileSizeBytes) + " \\u00b7 " + image.sha256.slice(0, 12)
      ));
      var flags = [];
      if (image.hasAlpha) flags.push("alpha");
      if (image.quality && image.quality.probableUpscale) flags.push("probable upscale");
      if (image.metadata && image.metadata.iccPresent) flags.push("ICC profile");
      if (flags.length) card.appendChild(el("div", "member-flags", flags.join(" \\u00b7 ")));

      appendCropRow(card, image);
    }

    var selectBtn = el("button", "btn btn-small", group.recommendedOriginalId === memberId ? "Recommended" : "Select as original");
    selectBtn.type = "button";
    selectBtn.addEventListener("click", function () {
      setDecision(group.id, "select-different", memberId);
    });
    card.appendChild(selectBtn);

    return card;
  }

  function setDecision(groupId, action, selectedImageId) {
    var existing = decisions[groupId];
    decisions[groupId] = {
      groupId: groupId,
      action: action,
      selectedImageId: selectedImageId,
      note: existing ? existing.note : undefined,
      selectedAt: new Date().toISOString(),
    };
    renderGroupList();
    renderDetail();
  }

  function setNote(groupId, note) {
    var existing = decisions[groupId];
    decisions[groupId] = {
      groupId: groupId,
      action: existing ? existing.action : "defer",
      selectedImageId: existing ? existing.selectedImageId : undefined,
      note: note || undefined,
      selectedAt: new Date().toISOString(),
    };
    renderGroupList();
  }

  function renderDetail() {
    while (detailEl.firstChild) detailEl.removeChild(detailEl.firstChild);

    var group = null;
    for (var i = 0; i < report.groups.length; i++) {
      if (report.groups[i].id === state.selectedGroupId) { group = report.groups[i]; break; }
    }
    if (!group) {
      detailEl.appendChild(el("p", "empty-state", "Select a group from the list to review it."));
      return;
    }

    detailEl.appendChild(el("h2", null, group.id));
    var summaryText = group.kind + " group \\u00b7 status " + group.status + " \\u00b7 confidence " + Math.round(group.confidence * 100) + "%";
    if (group.score !== undefined) summaryText += " \\u00b7 score " + group.score;
    detailEl.appendChild(el("p", "group-summary", summaryText));

    if (group.reasons && group.reasons.length) {
      var reasonsList = el("ul", "reasons");
      group.reasons.forEach(function (r) { reasonsList.appendChild(el("li", null, r)); });
      detailEl.appendChild(reasonsList);
    }
    if (group.warnings && group.warnings.length) {
      var warningsList = el("ul", "warnings");
      group.warnings.forEach(function (w) { warningsList.appendChild(el("li", null, w)); });
      detailEl.appendChild(warningsList);
    }

    var membersEl = el("div", "members-grid");
    group.members.forEach(function (memberId) {
      membersEl.appendChild(renderMemberCard(group, memberId));
    });
    detailEl.appendChild(membersEl);

    var actions = el("div", "actions");

    var approveBtn = el("button", "btn btn-primary", "Approve recommendation");
    approveBtn.type = "button";
    approveBtn.disabled = !group.recommendedOriginalId;
    approveBtn.addEventListener("click", function () {
      setDecision(group.id, "approve-recommendation", group.recommendedOriginalId);
    });
    actions.appendChild(approveBtn);

    var keepBtn = el("button", "btn", "Keep multiple");
    keepBtn.type = "button";
    keepBtn.addEventListener("click", function () { setDecision(group.id, "keep-multiple", undefined); });
    actions.appendChild(keepBtn);

    var notRelatedBtn = el("button", "btn", "Mark unrelated");
    notRelatedBtn.type = "button";
    notRelatedBtn.addEventListener("click", function () { setDecision(group.id, "not-related", undefined); });
    actions.appendChild(notRelatedBtn);

    var deferBtn = el("button", "btn", "Defer");
    deferBtn.type = "button";
    deferBtn.addEventListener("click", function () { setDecision(group.id, "defer", undefined); });
    actions.appendChild(deferBtn);

    detailEl.appendChild(actions);

    var noteLabel = el("label", "note-label", "Note");
    var noteInput = document.createElement("textarea");
    noteInput.className = "note-input";
    var existingDecision = decisions[group.id];
    noteInput.value = (existingDecision && existingDecision.note) || "";
    noteInput.addEventListener("change", function () { setNote(group.id, noteInput.value); });
    noteLabel.appendChild(document.createElement("br"));
    noteLabel.appendChild(noteInput);
    detailEl.appendChild(noteLabel);

    if (existingDecision) {
      var currentText = "Current decision: " + existingDecision.action;
      if (existingDecision.selectedImageId) {
        currentText += " (" + imageLabel(imagesById[existingDecision.selectedImageId]) + ")";
      }
      detailEl.appendChild(el("p", "current-decision", currentText));
    }
  }

  function populateRelationshipFilter() {
    var select = document.getElementById("filter-relationship");
    var relationships = {};
    report.groups.forEach(function (g) {
      relationshipsOf(g).forEach(function (r) { relationships[r] = true; });
    });
    Object.keys(relationships).sort().forEach(function (r) {
      var opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
  }

  function exportDecisions() {
    var list = Object.keys(decisions).map(function (id) { return decisions[id]; });
    var blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "decisions.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById("filter-confidence").addEventListener("input", function (e) {
    state.minConfidence = Number(e.target.value) / 100;
    document.getElementById("filter-confidence-value").textContent = e.target.value + "%";
    renderGroupList();
  });
  document.getElementById("filter-relationship").addEventListener("change", function (e) {
    state.relationship = e.target.value;
    renderGroupList();
  });
  document.getElementById("filter-unresolved").addEventListener("change", function (e) {
    state.unresolvedOnly = e.target.checked;
    renderGroupList();
  });
  document.getElementById("export-decisions").addEventListener("click", exportDecisions);

  document.getElementById("summary-generated").textContent =
    "Generated " + report.generatedAt + " \\u00b7 image-origin v" + report.toolVersion +
    " \\u00b7 " + report.images.length + " images \\u00b7 " + report.groups.length + " groups";

  populateRelationshipFilter();
  renderGroupList();
  renderDetail();
})();
`;
