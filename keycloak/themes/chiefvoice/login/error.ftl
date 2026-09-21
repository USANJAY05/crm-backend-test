<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
  <#if section = "header">
    ${msg("errorTitle")}
  <#elseif section = "form">
    <div class="cv-brand">
      <div class="cv-logo">
        <div class="cv-logo-icon">🎙️</div>
        <span class="cv-logo-text">Chief<span>Voice</span></span>
      </div>
    </div>

    <div class="alert alert-error" style="margin-bottom:24px">
      <span>✕</span>
      <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
    </div>

    <#if skipLink??>
    <#else>
      <a href="${properties.backToApplication!url.loginUrl}"
         class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
        ${kcSanitize(msg("backToApplication"))?no_esc}
      </a>
    </#if>

    <div class="cv-footer">&copy; ${.now?string("yyyy")} ChiefVoice</div>
  </#if>
</@layout.registrationLayout>
