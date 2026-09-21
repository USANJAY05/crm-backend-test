<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
  <#if section = "header">
    ${msg("infoTitle")}
  <#elseif section = "form">
    <div class="cv-brand">
      <div class="cv-logo">
        <div class="cv-logo-icon">🎙️</div>
        <span class="cv-logo-text">Chief<span>Voice</span></span>
      </div>
    </div>

    <div class="alert alert-${message.type!''}" style="margin-bottom:24px">
      <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
    </div>

    <#if requiredActions??>
      <ul style="color:var(--cv-text-muted);font-size:14px;padding-left:18px;margin-bottom:24px">
        <#list requiredActions as reqAction>
          <li>${kcSanitize(msg("requiredAction.${reqAction}"))?no_esc}</li>
        </#list>
      </ul>
    </#if>

    <#if skipLink??>
    <#elseif pageRedirectUri?has_content>
      <a href="${pageRedirectUri}"
         class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
        ${msg("backToApplication")}
      </a>
    <#elseif actionUri?has_content>
      <a href="${actionUri}"
         class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
        ${msg("proceedWithAction")}
      </a>
    <#elseif client.baseUrl?has_content>
      <a href="${client.baseUrl}"
         class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
        ${msg("backToApplication")}
      </a>
    </#if>

    <div class="cv-footer">&copy; ${.now?string("yyyy")} ChiefVoice</div>
  </#if>
</@layout.registrationLayout>
