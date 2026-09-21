<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('username'); section>

  <#if section = "header">
    ${msg("emailForgotTitle")}

  <#elseif section = "form">
    <div class="cv-brand">
      <div class="cv-logo">
        <div class="cv-logo-icon">🎙️</div>
        <span class="cv-logo-text">Chief<span>Voice</span></span>
      </div>
      <p class="cv-tagline">Reset your password</p>
    </div>

    <#if message?has_content>
      <div class="alert alert-${message.type}">
        <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
      </div>
    </#if>

    <form id="kc-reset-password-form" action="${url.loginAction}" method="post">
      <div class="${properties.kcFormGroupClass!} <#if messagesPerField.existsError('username')>has-error</#if>">
        <label for="username" class="${properties.kcLabelClass!}">
          <#if !realm.loginWithEmailAllowed>${msg("username")}
          <#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}
          <#else>${msg("email")}</#if>
        </label>
        <input type="text"
               id="username"
               name="username"
               class="${properties.kcInputClass!}"
               autofocus
               placeholder="<#if !realm.loginWithEmailAllowed>Username<#else>Email address</#if>"
               value="${(auth.attemptedUsername!'')?html}" />
        <#if messagesPerField.existsError('username')>
          <span style="color:var(--cv-error);font-size:13px;margin-top:5px;display:block">
            ${kcSanitize(messagesPerField.get('username'))?no_esc}
          </span>
        </#if>
      </div>

      <div style="display:flex;gap:12px;margin-top:4px">
        <a href="${url.loginUrl}"
           class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
           style="flex:1">
          ← Back
        </a>
        <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
               type="submit"
               value="${msg("doSubmit")}"
               style="flex:2" />
      </div>
    </form>

    <div class="cv-footer">
      &copy; ${.now?string("yyyy")} ChiefVoice
    </div>

  <#elseif section = "info">
    <p style="text-align:center;font-size:13.5px;color:var(--cv-text-muted);margin-top:20px">
      ${msg("emailInstruction")}
    </p>
  </#if>

</@layout.registrationLayout>
