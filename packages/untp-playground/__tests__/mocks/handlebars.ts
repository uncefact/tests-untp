module.exports = `<html lang="en">

 <head>
 <meta charset="UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <style>
 /* General Body Styles */ body { font-family: sans-serif; line-height:
 1.6; color: #333; background-color: white; margin: 0; word-break:
 break-word; } ul { padding: 0; } li { list-style-type: none; } /*
 Container Styles */ .container { max-width: 62.5rem; margin: 0 auto;
 padding: 0 0.9375rem; } /* Report Header Styles */ .report-header {
 background-color: #f8f9fa; border-bottom: 2px solid #dee2e6; padding:
 1.5rem; margin: 1.5rem 0; border-radius: 0.25rem; } .report-header h1 {
 font-size: 2rem; margin-bottom: 1rem; color: #495057; } .report-header p {
 margin-bottom: 0.25rem; } .report-header strong { margin-right: 0.25rem; }
 /* Row and Column Styles (Using CSS Grid) */ .row { display: grid;
 grid-template-columns: repeat(12, 1fr); /* 12-column grid */ gap:
 0.9375rem; /* 15px gap */ margin-left: -0.9375rem; margin-right:
 -0.9375rem; } .col-md-4, .col-md-5, .col-md-6 { padding-left: 0.9375rem;
 padding-right: 0.9375rem; box-sizing: border-box; } .col-md-4 {
 grid-column: span 4; } .col-md-5 { grid-column: span 5; } .col-md-6 {
 grid-column: span 6; } /* Card Styles */ .card { border: 1px solid
 #dee2e6; border-radius: 0.25rem; margin-bottom: 1.5rem; box-shadow: 0
 0.125rem 0.25rem rgba(0, 0, 0, 0.075); } .card-header { padding: 0.75rem
 1.25rem; background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; }
 .card-header h3 { margin-bottom: 0px; } .card-body { padding: 1.25rem; }
 .card-body.border-top { padding-right: 0.9375rem; box-sizing: border-box;
 } .col-md-4 { grid-column: span 4; } .col-md-5 { grid-column: span 5; }
 .col-md-6 { grid-column: span 6; } .card { border: 1px solid #dee2e6;
 border-radius: 0.25rem; margin-bottom: 1.5rem; box-shadow: 0 0.125rem
 0.25rem rgba(0, 0, 0, 0.075); } .card-header { padding: 0.75rem 1.25rem;
 background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; }
 .card-header h3 { margin-bottom: 0px; } .card-body { padding: 1.25rem; }
 .card-body.border-top { border-top: 1px solid #dee2e6; } .credential-info
 { display: flex; align-items: center; gap: 0.5rem; } /* Info Badge Styles
 */ .info-badge { align-items: center; padding: 3px 8px; font-size:
 0.65rem; font-weight: 600; border-radius: 12px; border: 1px solid; }
 .info-badge.type-badge { background-color: #fef9c3; color: #854d0e;
 border-color: #b3742c; } .enveloping-proof { display: none; }
 .embedded-proof.EnvelopedVerifiableCredential { display: none; }
 .enveloping-proof.EnvelopedVerifiableCredential { display: inline-block; }
 .info-badge.version-badge { background-color: hsla(137, 87%, 76%, 0.322);
 color: rgb(22, 161, 87); border-color: rgba(37, 168, 78, 0.8); }
 .info-badge.version-badge.v2 { display: inline-block; } /* Status Badge
 Styles */ .status-badge { display: inline-block; padding: 0.25em 0.4em;
 font-size: 0.8rem; font-weight: 600; line-height: 1; text-align: center;
 vertical-align: baseline; border-radius: 0.25rem; text-transform:
 capitalize; } .bg-failure { color: #fff; background-color: #dc3545; }
 .bg-success { color: #fff; background-color: #28a745; } /* Test Step
 Styles */ .test-step { border-left: 3px solid transparent; padding:
 0.75rem; margin-bottom: 0.5rem; border-radius: 0.25rem; }
 .test-step.failure { border-left-color: #dc3545; background-color:
 #fceded; } .test-step.success { border-left-color: #28a745;
 background-color: #f5fff7; } .test-step h5 { font-size: 1rem; } /* Error
 List Styles */ .error-list, .success-list { list-style-type: none;
 padding-left: 0; margin-top: 0.5rem; } .text-danger { color: #dc3545; }
 .text-success { color: #28a745; } .capitalize-first-letter:first-letter {
 text-transform: capitalize; } .small { font-size: 0.875rem; margin-bottom:
 1.5rem; } /* Credential Card Styles */ .credential-card {
 background-color: #f8f9fa; } .credential-card h3 { font-size: 1.2rem;
 margin-bottom: 0px; } .mb-0 { margin-bottom: 0px; } .mb-1 { margin-bottom:
 0.25rem; } .mb-2 { margin-bottom: 0.5rem; } .mb-3 { margin-bottom: 1rem; }
 .mb-4 { margin-bottom: 1.5rem; } .mt-2 { margin-top: 0.5rem; } .h5 {
 font-size: 1.25rem; } .h6 { font-size: 1rem; } .p-3 { padding: 0.75rem; }
 .p-4 { padding: 1.5rem; } .rounded { border-radius: 0.25rem; } .error-icon
 { padding-right: 0.3rem; } .error-details { padding-left: 1.2rem;
 line-height: 1; } .error-detail-item { } .grid-container { display: grid;
 grid-template-columns: 1fr auto; align-items: center; gap: 1rem; }
 .grid-container>span { justify-self: end; } .status-badge-lg { font-size:
 1rem; padding: 0.35em 0.65em; } .overall-status { display: flex;
 align-items: center; gap: 1rem; margin-bottom: 1.5rem; } /* Validation
 Summary Styling */ .validation-card { border: 1px solid #e9ecef;
 border-radius: 6px; background: #fff; padding: 15px; position: relative;
 box-shadow: 0 1px 3px rgba(0,0,0,0.05); } .validation-title { font-size:
 1.1rem; font-weight: 600; margin: 0 0 8px 0; display: flex; align-items:
 center; gap: 8px; } .validation-badge { display: inline-block; padding:
 3px 8px; font-size: 0.75rem; font-weight: 600; border-radius: 12px;
 background-color: #e7f0ff; color: #0d6efd; width: fit-content; }
 .validation-subtitle { font-size: 0.9rem; color: #6c757d; margin: 8px 0 0
 0; padding-left: 12px; border-left: 2px solid #dee2e6; } /* Media Queries
 */ /* Mobile Styles (<= 580px) */ @media (min-width: 1rem) and (max-width:
 36.25rem) { .container { padding: 0 0.625rem; } .report-header { padding:
 1rem; } .report-header h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
 .validation-title, .overall-status { flex-direction: column; } .row {
 grid-template-columns: 1fr; margin-left: 0; margin-right: 0; gap: 0.5rem;
 } .col-md-4, .col-md-5, .col-md-6 { grid-column: span 12; padding-left: 0;
 padding-right: 0; } .card-body { padding: 0.75rem; } .card-body h4,
 .card-body h5, .card-body h6 { word-break: break-word; } .test-step {
 padding: 0.5rem; text-align: center; } .grid-container {
 grid-template-columns: 1fr; justify-items: center; } .grid-container>span
 { justify-self: center; } .test-step .success-list, .test-step .error-list
 { list-style: none; padding-left: 0; } .error-details { padding-left: 0; }
 .error-list li, .success-list li { margin-left: 0; } .info-badge {
 margin-right: 0.3rem; padding: 0.15rem 0.4rem; font-size: 0.7rem; } }
 </style>
 </head>

 <body>
 <div class="container my-5">
 <div class="report-header rounded">
 <div class="overall-status">
 <h1 class="mb-3">{{credentialSubject.reportName}}</h1>
 </div>
 <div class="row">
 <div class="col-md-6">
 <p class="mb-1"><strong>Date:</strong>
 {{credentialSubject.date}}</p>
 <p class="mb-1"><strong>Test Runner:</strong>
 {{credentialSubject.testSuite.runner}}
 - v{{credentialSubject.testSuite.version}}</p>
 </div>
 <div class="col-md-6">
 <p class="mb-1"><strong>Implementation:</strong>
 {{credentialSubject.implementation.name}}</p>
 </div>
 </div>
 </div>

 {{#each credentialSubject.results}}
 <div class="card mb-4">
 <div class="card-body border-top">
 <h4 class="validation-summary mb-3">
 <div>
 {{#if extension}}
 <h3 class="validation-title">
 {{extension.type}}
 -
 {{extension.version}}
 </h3>
 <p class="validation-subtitle">Extension of
 {{core.type}}
 {{core.version}}</p>
 {{else}}
 <h3 class="validation-title">
 {{core.type}}
 -
 {{core.version}}
 </h3>
 {{/if}}
 </div>
 </h4>

 {{! Core Steps }}
 {{#each core.steps}}
 <div class="test-step p-3 mb-2 rounded {{status}}">
 <div class="grid-container">
 <div>
 <h5>{{name}}</h5>
 {{#if details}}
 {{#if details.errors}}
 <ul class="mt-2">
 {{#each details.errors}}
 <li class="text-danger small">
 <span class="error-icon">❌ {{message}}:</span>
 <div class="error-details">
 {{#if params.allowedValue}}
 <p
 class="error-detail-item"
 >{{params.allowedValue}}</p>
 {{/if}}
 {{#if params.allowedValues}}
 {{#each params.allowedValues}}
 <p class="error-detail-item">{{this}}</p>
 {{/each}}
 {{/if}}
 </div>
 </li>
 {{/each}}
 </ul>
 {{/if}}
 {{/if}}
 </div>
 <span
 class="badge status-badge bg-{{status}}"
 >{{status}}</span>
 </div>
 </div>
 {{/each}}

 {{! Extension Steps }}
 {{#if extension}}
 {{#each extension.steps}}
 <div class="test-step p-3 mb-2 rounded {{status}}">
 <div class="grid-container">
 <div>
 <h5>{{name}}</h5>
 {{#if details}}
 {{#if details.errors}}
 <ul class="error-list mt-2">
 {{#each details.errors}}
 <li class="text-danger small">
 <p class="error-icon">❌ {{message}}:</p>
 <div class="error-details">
 {{#if params.additionalProperty}}
 <span
 class="error-detail-item"
 >{{params.additionalProperty}}</span>
 {{/if}}
 {{#if params.allowedValue}}
 <p
 class="error-detail-item"
 >{{params.allowedValue}}</p>
 {{/if}}
 {{#if params.allowedValues}}
 {{#each params.allowedValues}}
 <p class="error-detail-item">{{this}}</p>
 {{/each}}
 {{/if}}
 </div>
 </li>
 {{/each}}
 </ul>
 {{/if}}
 {{/if}}
 </div>
 <span
 class="badge status-badge bg-{{status}}"
 >{{status}}</span>
 </div>
 </div>
 {{/each}}
 {{/if}}
 </div>
 </div>
 {{/each}}
 </div>
 </body>

</html>`;
