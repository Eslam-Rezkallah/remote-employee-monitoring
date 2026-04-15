import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface Company {
  name: string;
  logo: string;
}

interface FaqItem {
  question: string;
  questionAr: string;
  answer: string;
  answerAr: string;
  open: boolean;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css'],
})
export class LandingComponent implements OnInit, OnDestroy {

  isArabic = signal(false);
  toggleLang() { this.isArabic.update(v => !v); }

  companies: Company[] = [
    { name: 'Acme Corp',        logo: '🏢' },
    { name: 'Globex',           logo: '🌐' },
    { name: 'Initech',          logo: '💼' },
    { name: 'Umbrella Co',      logo: '☂️'  },
    { name: 'Stark Industries', logo: '⚙️' },
    { name: 'Pied Piper',       logo: '🎵' },
    { name: 'Hooli',            logo: '🚀' },
    { name: 'Dunder Mifflin',   logo: '📄' },
  ];

  carouselIndex = 0;
  private carouselTimer: any;

  nextSlide() { this.carouselIndex = (this.carouselIndex + 1) % this.companies.length; }
  prevSlide() { this.carouselIndex = (this.carouselIndex - 1 + this.companies.length) % this.companies.length; }

  get visibleCompanies(): Company[] {
    const result: Company[] = [];
    for (let i = 0; i < 4; i++) {
      result.push(this.companies[(this.carouselIndex + i) % this.companies.length]);
    }
    return result;
  }

  faqs: FaqItem[] = [
    {
      question:   'What is REM?',
      questionAr: 'ما هو نظام REM؟',
      answer:     'REM (Remote Employee Management) is an all-in-one platform that helps companies manage, track, and engage distributed teams from one central dashboard.',
      answerAr:   'REM هو منصة متكاملة تساعد الشركات على إدارة وتتبع الفرق الموزعة جغرافياً من لوحة تحكم مركزية واحدة.',
      open: false,
    },
    {
      question:   'Is there a free plan?',
      questionAr: 'هل يوجد خطة مجانية؟',
      answer:     'Yes! You can get started for free with up to 5 team members. No credit card required.',
      answerAr:   'نعم! يمكنك البدء مجاناً لما يصل إلى 5 موظفين دون الحاجة لبطاقة ائتمان.',
      open: false,
    },
    {
      question:   'How secure is my data?',
      questionAr: 'ما مدى أمان بياناتي؟',
      answer:     'We use industry-standard AES-256 encryption, regular security audits, and comply with GDPR and SOC 2 standards.',
      answerAr:   'نستخدم تشفير AES-256 المعياري، ومراجعات أمنية دورية، ونمتثل لمعايير GDPR و SOC 2.',
      open: false,
    },
    {
      question:   'Can I integrate with other tools?',
      questionAr: 'هل يمكنني التكامل مع أدوات أخرى؟',
      answer:     'Absolutely. REM integrates with Slack, Google Workspace, Microsoft 365, Jira, and many more via our API.',
      answerAr:   'بالتأكيد. يتكامل REM مع Slack وGoogle Workspace وMicrosoft 365 وJira والمزيد عبر API الخاص بنا.',
      open: false,
    },
    {
      question:   'Do you offer customer support?',
      questionAr: 'هل تقدمون دعم العملاء؟',
      answer:     'Yes, we provide 24/7 live chat and email support for all paid plans, and community support for the free tier.',
      answerAr:   'نعم، نقدم دعماً عبر الدردشة المباشرة والبريد الإلكتروني على مدار الساعة لجميع الخطط المدفوعة.',
      open: false,
    },
  ];

  toggleFaq(index: number) {
    this.faqs = this.faqs.map((f, i) => ({ ...f, open: i === index ? !f.open : false }));
  }

  scrollTo(sectionId: string) {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  ngOnInit() { this.carouselTimer = setInterval(() => this.nextSlide(), 3000); }
  ngOnDestroy() { clearInterval(this.carouselTimer); }
}
