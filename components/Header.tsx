"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import SearchDialog from "./SearchDialog";

const navigation = [
  { href: "/", label: "홈" },
  { href: "/news", label: "뉴스" },
  { href: "/research", label: "리서치" },
  { href: "/projects", label: "프로젝트" },
  { href: "/about", label: "소개" },
];

export function Header() {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenuOpen(false);
        setSearchOpen((open) => !open);
      }
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openSearch = () => {
    setMenuOpen(false);
    setSearchOpen(true);
  };

  return (
    <>
      <header className="site-header">
        <Link
          className="header-brand"
          href="/"
          aria-label="EVAN 홈"
          onClick={() => setMenuOpen(false)}
        >
          EVAN
          <span className="header-brand-dot" aria-hidden="true" />
        </Link>

        <nav className="header-nav" aria-label="주 메뉴">
          {navigation.map(({ href, label }) => {
            const active =
              href === "/" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={
                  active ? "header-nav-link is-active" : "header-nav-link"
                }
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="header-actions">
          <button
            className="header-search"
            type="button"
            onClick={openSearch}
            aria-label="콘텐츠 검색, 단축키 Command 또는 Control K"
          >
            <Search size={17} strokeWidth={1.7} aria-hidden="true" />
            <span className="header-search-placeholder">검색하기...</span>
            <kbd>⌘ K</kbd>
          </button>
          <Link className="header-profile" href="/about" aria-label="EVAN 소개">
            E
          </Link>
          <button
            className="header-menu-button"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="site-mobile-nav"
            aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
          >
            {menuOpen ? (
              <X size={22} aria-hidden="true" />
            ) : (
              <Menu size={22} aria-hidden="true" />
            )}
          </button>
        </div>

        {menuOpen && (
          <nav
            id="site-mobile-nav"
            className="mobile-nav"
            aria-label="모바일 주 메뉴"
          >
            {navigation.map(({ href, label }) => {
              const active =
                href === "/" ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={active ? "is-active" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </>
  );
}

export default Header;
