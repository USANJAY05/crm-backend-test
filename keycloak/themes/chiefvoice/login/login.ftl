<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>

  <#if section = "header">
    ${msg("loginAccountTitle")}

  <#elseif section = "form">

    <!-- ── Brand header ──────────────────────────────────────────── -->
    <div class="cv-brand">
      <div class="cv-logo">
        <div class="cv-logo-icon">🎙️</div>
        <span class="cv-logo-text">Chief<span>Voice</span></span>
      </div>
      <p class="cv-tagline">AI-powered voice CRM — sign in to your workspace</p>
    </div>

    <!-- ── Alerts ─────────────────────────────────────────────────── -->
    <#if message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
      <div class="alert alert-${message.type}">
        <#if message.type = 'success'><span>✓</span></#if>
        <#if message.type = 'warning'><span>⚠</span></#if>
        <#if message.type = 'error'><span>✕</span></#if>
        <#if message.type = 'info'><span>ℹ</span></#if>
        <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
      </div>
    </#if>

    <!-- ── Login form ─────────────────────────────────────────────── -->
    <form id="kc-form-login" class="${properties.kcFormClass!}"
          onsubmit="login.disabled = true; return true;"
          action="${url.loginAction}" method="post">

      <!-- Username / email -->
      <div class="${properties.kcFormGroupClass!} <#if messagesPerField.existsError('username','password')>has-error</#if>">
        <label for="username" class="${properties.kcLabelClass!}">
          <#if !realm.loginWithEmailAllowed>${msg("username")}
          <#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}
          <#else>${msg("email")}</#if>
        </label>
        <input tabindex="1"
               id="username"
               name="username"
               class="${properties.kcInputClass!}"
               type="text"
               autofocus
               autocomplete="username email"
               value="${(login.username!'')?html}"
               placeholder="<#if !realm.loginWithEmailAllowed>Username<#elseif !realm.registrationEmailAsUsername>Email or username<#else>Email address</#if>"
               aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>" />
        <#if messagesPerField.existsError('username')>
          <span class="help-block" style="color:var(--cv-error);font-size:13px;margin-top:5px;display:block">
            ${kcSanitize(messagesPerField.get('username'))?no_esc}
          </span>
        </#if>
      </div>

      <!-- Password -->
      <#if realm.password>
        <div class="${properties.kcFormGroupClass!} <#if messagesPerField.existsError('username','password')>has-error</#if>">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
            <label for="password" class="${properties.kcLabelClass!}" style="margin:0">
              ${msg("password")}
            </label>
            <#if realm.resetPasswordAllowed>
              <a tabindex="5" href="${url.loginResetCredentialsUrl}" style="font-size:13px">
                ${msg("doForgotPassword")}
              </a>
            </#if>
          </div>
          <input tabindex="2"
                 id="password"
                 name="password"
                 class="${properties.kcInputClass!}"
                 type="password"
                 autocomplete="current-password"
                 placeholder="••••••••"
                 aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>" />
          <#if messagesPerField.existsError('password')>
            <span class="help-block" style="color:var(--cv-error);font-size:13px;margin-top:5px;display:block">
              ${kcSanitize(messagesPerField.get('password'))?no_esc}
            </span>
          </#if>
        </div>
      </#if>

      <!-- Remember me -->
      <#if realm.rememberMe && !usernameEditDisabled??>
        <div class="checkbox" style="margin-bottom:20px">
          <label>
            <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox"
                   <#if login.rememberMe??>checked</#if> />
            ${msg("rememberMe")}
          </label>
        </div>
      </#if>

      <!-- Submit -->
      <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
        <input type="hidden" id="id-hidden-input" name="credentialId"
               <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if> />
        <input tabindex="4"
               class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
               name="login"
               id="kc-login"
               type="submit"
               value="${msg("doLogIn")}" />
      </div>
    </form>

    <!-- ── Social providers ───────────────────────────────────────── -->
    <#if realm.password && social.providers??>
      <div class="kc-divider">or continue with</div>
      <div id="kc-social-providers">
        <ul class="${properties.kcFormSocialAccountListClass!}
                  <#if social.providers?size gt 3>${properties.kcFormSocialAccountDoubleListClass!}</#if>">
          <#list social.providers as p>
            <li class="${properties.kcFormSocialAccountListLinkClass!}">
              <a href="${p.loginUrl}" id="zocial-${p.alias}" class="btn btn-default btn-block">
                <#if p.iconClasses?has_content>
                  <i class="${p.iconClasses!}" aria-hidden="true"></i>
                </#if>
                <span>${p.displayName!}</span>
              </a>
            </li>
          </#list>
        </ul>
      </div>
    </#if>

    <!-- ── Footer ─────────────────────────────────────────────────── -->
    <div class="cv-footer">
      &copy; ${.now?string("yyyy")} ChiefVoice &nbsp;·&nbsp;
      <a href="mailto:support@chiefvoice.ai">support@chiefvoice.ai</a>
    </div>

  <#elseif section = "info">
    <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
      <div style="text-align:center;margin-top:20px;font-size:13.5px;color:var(--cv-text-muted)">
        ${msg("noAccount")}
        <a tabindex="6" href="${url.registrationUrl}">${msg("doRegister")}</a>
      </div>
    </#if>
  </#if>

</@layout.registrationLayout>
