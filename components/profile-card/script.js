const button = document.querySelector('.profile button');
button.addEventListener('click', () => {
  const following = button.classList.toggle('following');
  button.textContent = following ? 'Following' : 'Follow';
});
