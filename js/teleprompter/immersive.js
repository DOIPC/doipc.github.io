/* =========================================================
   沉浸模式：一键隐藏全部上层 UI，只留星空特效
   —— 通过给 .ui-shell 切换 .is-hidden 触发 max-height 过渡
   —— 不改动 .container 内部任何布局
   ========================================================= */
(function immersiveMode() {
    'use strict';

    const shell = document.getElementById('uiShell');
    const btn = document.getElementById('immersiveToggle');
    const icon = document.getElementById('immersiveIcon');
    const text = document.getElementById('immersiveText');
    if (!shell || !btn) return;

    let hidden = false;

    function render() {
        shell.classList.toggle('is-hidden', hidden);
        shell.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
        icon.textContent = hidden ? '👁' : '🌌';
        text.textContent = hidden ? '显示界面' : '沉浸模式';
        btn.title = hidden ? '重新显示编辑界面' : '隐藏界面，仅欣赏星空';
    }

    btn.addEventListener('click', () => {
        hidden = !hidden;
        render();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && hidden) {
            hidden = false;
            render();
        }
    });

    render();
})();