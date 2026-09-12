// Phase 4: where the work comes from, and what it cost to get it.
import {
  api, get, esc, card, list, money, moneyShort, fmtDate, titleCase,
  openForm, toast, attempt, state,
} from './ui.js';

/**
 * The app does not send anything itself - that would mean holding mail or SMS
 * credentials for a household tool. It writes the message and hands it to the
 * phone's own mail or messages app, then tracks what was asked and answered.
 */
function reviewMessage(request) {
  const who = request.client_name ? request.client_name.split(' ')[0] : 'there';
  return `Hi ${who} - thanks again for letting us take care of ${request.job_title}. `
    + 'If you were happy with how it went, a short review would really help us out. '
    + 'Thanks either way, and give us a shout if anything needs looking at.';
}

function contactLink(request) {
  const body = encodeURIComponent(reviewMessage(request));
  if (request.client_email) {
    return `<a class="btn btn-sm" href="mailto:${esc(request.client_email)}?subject=${
      encodeURIComponent('Quick favour')}&body=${body}">Email</a>`;
  }
  if (request.client_phone) {
    return `<a class="btn btn-sm" href="sms:${esc(request.client_phone.replace(/[^\d+]/g, ''))}&body=${body}">Text</a>`;
  }
  return '';
}

export async function marketingPanel() {
  const [report, reviews] = await Promise.all([
    get('/api/reports/marketing'),
    get('/api/review-requests'),
  ]);

  const campaignRow = (c) => `<tr>
    <td><strong>${esc(c.name)}</strong><br><span class="meta">${esc(titleCase(c.channel))}${
      c.ended_on ? ` &middot; ended ${fmtDate(c.ended_on)}` : ` &middot; since ${fmtDate(c.started_on)}`}</span></td>
    <td class="num">${money(c.spend_cents)}</td>
    <td class="num">${c.lead_count}</td>
    <td class="num">${c.won_count}</td>
    <td class="num">${c.cost_per_won_job_cents === null ? '—' : money(c.cost_per_won_job_cents)}</td>
    <td class="num">${c.return_multiple === null ? '—' : `${c.return_multiple}x`}</td>
    <td class="num"><button class="btn btn-sm" data-campaign="${c.id}" type="button">Edit</button></td>
  </tr>`;

  const campaigns = report.campaigns.length
    ? `<div class="scroll-x"><table class="table lines"><thead><tr>
        <th>Campaign</th><th class="num">Spent</th><th class="num">Leads</th>
        <th class="num">Won</th><th class="num">Cost per win</th><th class="num">Return</th><th></th>
      </tr></thead><tbody>${report.campaigns.map(campaignRow).join('')}</tbody></table></div>`
    : '<p class="empty">No campaigns yet. Add one, then tag its costs on the expense that paid for it.</p>';

  const referrals = report.referrals.length
    ? `<table class="table"><tbody>${report.referrals.map((r) => `<tr>
        <td><a href="#/clients/${r.client_id}">${esc(r.client_name)}</a></td>
        <td class="num meta">${r.won_count} of ${r.referred_count} won</td>
        <td class="num"><strong>${money(r.won_value_cents)}</strong></td>
      </tr>`).join('')}</tbody></table>`
    : `<p class="empty">Nobody credited yet. Set <em>Who sent them?</em> on a lead and the
        people who keep you booked show up here.</p>`;

  const reviewRow = (r) => `<li><div class="list-link" data-review-row="${r.id}">
    <span>
      <span class="title">${esc(r.client_name ?? 'No client on file')}</span>
      <span class="pill review-${esc(r.status)}">${esc(titleCase(r.status))}</span>
      ${r.rating ? `<span class="pill stage-after">${'★'.repeat(r.rating)}</span>` : ''}
      <br><span class="meta">${esc(r.job_number)} ${esc(r.job_title)}${
        r.requested_on ? ` &middot; asked ${fmtDate(r.requested_on)}` : ''}</span>
      ${r.notes ? `<br><span class="meta">${esc(r.notes)}</span>` : ''}
    </span>
    <span class="right">
      ${r.status === 'pending' ? contactLink(r) : ''}
      <button class="btn btn-sm" data-review="${r.id}" type="button">Update</button>
    </span>
  </div></li>`;

  const funnel = report.reviews;

  return `
    <div class="tiles">
      <div class="card tile"><div class="n">${moneyShort(report.totals.spend_cents)}</div>
        <div class="k">Marketing spend</div></div>
      <div class="card tile"><div class="n">${
        report.totals.cost_per_won_job_cents === null ? '—' : moneyShort(report.totals.cost_per_won_job_cents)
      }</div><div class="k">Cost per job won</div></div>
      <div class="card tile${funnel.waiting_to_ask ? ' alert' : ''}"><div class="n">${funnel.waiting_to_ask}</div>
        <div class="k">Reviews to ask for</div></div>
      <div class="card tile"><div class="n">${
        funnel.average_rating === null ? '—' : funnel.average_rating}</div>
        <div class="k">Average rating (${funnel.received})</div></div>
    </div>
    <div class="stack" style="margin-bottom:16px">
      ${card('Campaigns', campaigns, { flush: true,
        actions: '<button class="btn btn-sm btn-primary" id="new-campaign" type="button">Add campaign</button>' })}
    </div>
    <div class="two-col">
      ${card('Who keeps you booked', referrals, { flush: true })}
      ${card(`Reviews${funnel.waiting_to_ask ? ` — ${funnel.waiting_to_ask} to ask` : ''}`,
        list(reviews.requests, reviewRow,
          'Nothing to ask for yet. Finishing a job queues a request here automatically.'),
        { flush: true })}
    </div>`;
}

export function wireMarketing(root, refreshTab) {
  root.querySelectorAll('[data-campaign]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const campaign = await get(`/api/campaigns/${btn.dataset.campaign}`);
      editCampaign(campaign, refreshTab);
    });
  });
  root.querySelectorAll('[data-review]').forEach((btn) => {
    btn.addEventListener('click', () => updateReview(btn.dataset.review, refreshTab));
  });
  root.querySelector('#new-campaign')?.addEventListener('click', () => editCampaign(null, refreshTab));
}

function campaignFields(campaign) {
  return [
    { name: 'name', label: 'What is it?', required: true, value: campaign?.name ?? '',
      hint: 'e.g. Truck lettering, Little League sponsorship, yard signs' },
    { name: 'channel', label: 'Kind', type: 'select', value: campaign?.channel ?? 'yard_sign',
      options: (state.meta.campaign_channels ?? []).map((c) => ({ value: c, label: titleCase(c) })) },
    { name: 'started_on', label: 'Started', type: 'date', value: campaign?.started_on ?? '' },
    { name: 'ended_on', label: 'Ended', type: 'date', value: campaign?.ended_on ?? '' },
    { name: 'notes', label: 'Notes', type: 'textarea', value: campaign?.notes ?? '' },
  ];
}

async function editCampaign(campaign, refreshTab) {
  const form = await openForm({
    title: campaign ? 'Edit campaign' : 'New campaign',
    submitLabel: campaign ? 'Save' : 'Add campaign',
    fields: campaign
      ? campaignFields(campaign).concat([
        { name: 'remove', label: 'Delete this campaign', type: 'checkbox', value: false },
      ])
      : campaignFields(null),
  });
  if (!form) return;

  if (form.remove) {
    if (!confirm('Delete this campaign? Its leads and costs stay, they just stop being attributed.')) return;
    await api('DELETE', `/api/campaigns/${campaign.id}`);
    toast('Campaign deleted');
    refreshTab();
    return;
  }

  const { remove, ...payload } = form;
  try {
    await (campaign
      ? api('PATCH', `/api/campaigns/${campaign.id}`, payload)
      : api('POST', '/api/campaigns', payload));
    toast(campaign ? 'Campaign updated' : 'Campaign added');
    refreshTab();
  } catch (err) {
    toast(err.message);
  }
}

async function updateReview(id, refreshTab) {
  const form = await openForm({
    title: 'Review request',
    submitLabel: 'Save',
    fields: [
      { name: 'status', label: 'Where is it up to?', type: 'select', value: 'sent',
        options: (state.meta.review_statuses ?? []).map((s) => ({ value: s, label: titleCase(s) })) },
      { name: 'channel', label: 'How did you ask?', type: 'select', value: 'email',
        options: [{ value: '', label: '—' }]
          .concat((state.meta.review_channels ?? []).map((c) => ({ value: c, label: titleCase(c) }))) },
      { name: 'rating', label: 'Stars, if they left a review', type: 'select', value: '',
        options: [{ value: '', label: '—' }]
          .concat([1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) }))) },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  });
  if (!form) return;

  try {
    await api('PATCH', `/api/review-requests/${id}`, form);
    toast('Updated');
    refreshTab();
  } catch (err) {
    toast(err.message);
  }
}
